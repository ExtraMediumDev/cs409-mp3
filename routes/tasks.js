var User = require('../models/user');
var Task = require('../models/task');
var helpers = require('./helpers');

var send = helpers.send;
var isObjectId = helpers.isObjectId;

async function readTaskBody(body, res) {
    var name = body.name;
    var deadline = body.deadline;

    if (typeof name !== 'string' || name.trim() === '') {
        send(res, 400, 'Name is required', null);
        return null;
    }
    if (typeof deadline !== 'string' || Number.isNaN(Date.parse(deadline))) {
        send(res, 400, 'Deadline is required', null);
        return null;
    }

    var description = body.description === undefined ? '' : body.description;
    if (typeof description !== 'string') {
        send(res, 400, 'Description must be a string', null);
        return null;
    }

    var completed = body.completed === undefined ? false : body.completed;
    if (typeof completed !== 'boolean') {
        send(res, 400, 'Completed must be true or false', null);
        return null;
    }

    var assignedUser = body.assignedUser === undefined ? '' : body.assignedUser;
    if (typeof assignedUser !== 'string') {
        send(res, 400, 'Invalid assigned user', null);
        return null;
    }

    var assignedUserName = body.assignedUserName;
    if (assignedUserName !== undefined && typeof assignedUserName !== 'string') {
        send(res, 400, 'Assigned user name does not match', null);
        return null;
    }

    if (assignedUser === '') {
        if (assignedUserName !== undefined && assignedUserName !== 'unassigned') {
            send(res, 400, 'Assigned user name does not match', null);
            return null;
        }
        return {
            name: name,
            description: description,
            deadline: new Date(deadline),
            completed: completed,
            assignedUser: '',
            assignedUserName: 'unassigned'
        };
    }

    assignedUser = assignedUser.toLowerCase();
    if (!isObjectId(assignedUser)) {
        send(res, 400, 'Invalid assigned user', null);
        return null;
    }

    var user = await User.findById(assignedUser);
    if (!user) {
        send(res, 404, 'User not found', null);
        return null;
    }
    if (assignedUserName !== undefined && assignedUserName !== user.name) {
        send(res, 400, 'Assigned user name does not match', null);
        return null;
    }

    return {
        name: name,
        description: description,
        deadline: new Date(deadline),
        completed: completed,
        assignedUser: String(user._id),
        assignedUserName: user.name
    };
}

async function syncTaskUsers(taskId, oldUser, newUser, completed) {
    if (oldUser && oldUser !== newUser) {
        await User.updateOne({ _id: oldUser }, { $pull: { pendingTasks: taskId } });
    }
    if (!newUser) return;
    if (completed) {
        await User.updateOne({ _id: newUser }, { $pull: { pendingTasks: taskId } });
    } else {
        await User.updateOne({ _id: newUser }, { $addToSet: { pendingTasks: taskId } });
    }
}

module.exports = function (router) {
    router.route('/tasks')
        .get(async function (req, res) {
            try {
                await helpers.listDocuments(Task, req, res, 100);
            } catch (err) {
                if (!res.headersSent) send(res, 500, 'Something went wrong', null);
            }
        })
        .post(async function (req, res) {
            try {
                var parsed = await readTaskBody(req.body || {}, res);
                if (!parsed) return;
                var task = new Task({
                    name: parsed.name,
                    description: parsed.description,
                    deadline: parsed.deadline,
                    completed: parsed.completed,
                    assignedUser: parsed.assignedUser,
                    assignedUserName: parsed.assignedUserName,
                    dateCreated: new Date()
                });
                await task.save();
                await syncTaskUsers(String(task._id), '', parsed.assignedUser, parsed.completed);
                send(res, 201, 'OK', task);
            } catch (err) {
                if (!res.headersSent) send(res, 500, 'Something went wrong', null);
            }
        });

    router.route('/tasks/:id')
        .get(async function (req, res) {
            try {
                await helpers.getOne(Task, req, res, 'Task');
            } catch (err) {
                if (!res.headersSent) send(res, 500, 'Something went wrong', null);
            }
        })
        .put(async function (req, res) {
            try {
                if (!isObjectId(req.params.id)) return send(res, 404, 'Task not found', null);
                var task = await Task.findById(req.params.id);
                if (!task) return send(res, 404, 'Task not found', null);
                var parsed = await readTaskBody(req.body || {}, res);
                if (!parsed) return;
                var oldUser = (task.assignedUser || '').toLowerCase();
                var created = task.dateCreated;
                task.name = parsed.name;
                task.description = parsed.description;
                task.deadline = parsed.deadline;
                task.completed = parsed.completed;
                task.assignedUser = parsed.assignedUser;
                task.assignedUserName = parsed.assignedUserName;
                task.dateCreated = created;
                await task.save();
                await syncTaskUsers(String(task._id), oldUser, parsed.assignedUser, parsed.completed);
                send(res, 200, 'OK', task);
            } catch (err) {
                if (!res.headersSent) send(res, 500, 'Something went wrong', null);
            }
        })
        .delete(async function (req, res) {
            try {
                if (!isObjectId(req.params.id)) return send(res, 404, 'Task not found', null);
                var task = await Task.findById(req.params.id);
                if (!task) return send(res, 404, 'Task not found', null);
                var data = task.toObject();
                if (task.assignedUser) {
                    await User.updateOne(
                        { _id: task.assignedUser },
                        { $pull: { pendingTasks: String(task._id) } }
                    );
                }
                await task.deleteOne();
                send(res, 200, 'OK', data);
            } catch (err) {
                if (!res.headersSent) send(res, 500, 'Something went wrong', null);
            }
        });

    return router;
};
