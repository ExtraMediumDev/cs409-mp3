var User = require('../models/user');
var Task = require('../models/task');
var helpers = require('./helpers');

var send = helpers.send;
var isObjectId = helpers.isObjectId;

async function readUserBody(body, res, currentId) {
    var name = body.name;
    var email = body.email;

    if (typeof name !== 'string' || name.trim() === '') {
        send(res, 400, 'Name is required', null);
        return null;
    }
    if (typeof email !== 'string' || email.trim() === '') {
        send(res, 400, 'Email is required', null);
        return null;
    }

    var pending = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (!Array.isArray(pending)) {
        send(res, 400, 'pendingTasks must be a list of task ids', null);
        return null;
    }

    var ids = [];
    for (var i = 0; i < pending.length; i++) {
        if (!isObjectId(pending[i])) {
            send(res, 400, 'Invalid task id in pendingTasks', null);
            return null;
        }
        var id = pending[i].toLowerCase();
        if (ids.indexOf(id) === -1) ids.push(id);
    }

    var emailQuery = { email: email };
    if (currentId) emailQuery._id = { $ne: currentId };
    var duplicate = await User.findOne(emailQuery);
    if (duplicate) {
        send(res, 400, 'Email already exists', null);
        return null;
    }

    if (ids.length > 0) {
        var tasks = await Task.find({ _id: { $in: ids } });
        if (tasks.length !== ids.length) {
            send(res, 404, 'Task not found', null);
            return null;
        }
        for (var j = 0; j < tasks.length; j++) {
            if (tasks[j].completed) {
                send(res, 400, 'Completed tasks cannot be pending', null);
                return null;
            }
        }
    }

    return { name: name, email: email, pendingTasks: ids };
}

async function syncUserTasks(user, name, email, newIds) {
    var oldIds = (user.pendingTasks || []).map(function (id) { return String(id).toLowerCase(); });
    var removed = oldIds.filter(function (id) { return newIds.indexOf(id) === -1; });
    var added = newIds.filter(function (id) { return oldIds.indexOf(id) === -1; });

    if (removed.length > 0) {
        await Task.updateMany(
            { _id: { $in: removed } },
            { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
        );
    }

    if (added.length > 0) {
        await User.updateMany(
            { _id: { $ne: user._id }, pendingTasks: { $in: added } },
            { $pull: { pendingTasks: { $in: added } } }
        );
        await Task.updateMany(
            { _id: { $in: added } },
            { $set: { assignedUser: String(user._id), assignedUserName: name } }
        );
    }

    await Task.updateMany(
        { assignedUser: String(user._id) },
        { $set: { assignedUserName: name } }
    );

    user.name = name;
    user.email = email;
    user.pendingTasks = newIds;
    await user.save();
    return user;
}

module.exports = function (router) {
    router.route('/users')
        .get(async function (req, res) {
            try {
                await helpers.listDocuments(User, req, res);
            } catch (err) {
                if (!res.headersSent) send(res, 500, 'Something went wrong', null);
            }
        })
        .post(async function (req, res) {
            try {
                var parsed = await readUserBody(req.body || {}, res, null);
                if (!parsed) return;
                var user = new User({
                    name: parsed.name,
                    email: parsed.email,
                    pendingTasks: [],
                    dateCreated: new Date()
                });
                await user.save();
                user = await syncUserTasks(user, parsed.name, parsed.email, parsed.pendingTasks);
                send(res, 201, 'OK', user);
            } catch (err) {
                if (!res.headersSent) send(res, 500, 'Something went wrong', null);
            }
        });

    router.route('/users/:id')
        .get(async function (req, res) {
            try {
                await helpers.getOne(User, req, res, 'User');
            } catch (err) {
                if (!res.headersSent) send(res, 500, 'Something went wrong', null);
            }
        })
        .put(async function (req, res) {
            try {
                if (!isObjectId(req.params.id)) return send(res, 404, 'User not found', null);
                var user = await User.findById(req.params.id);
                if (!user) return send(res, 404, 'User not found', null);
                var parsed = await readUserBody(req.body || {}, res, user._id);
                if (!parsed) return;
                user = await syncUserTasks(user, parsed.name, parsed.email, parsed.pendingTasks);
                send(res, 200, 'OK', user);
            } catch (err) {
                if (!res.headersSent) send(res, 500, 'Something went wrong', null);
            }
        })
        .delete(async function (req, res) {
            try {
                if (!isObjectId(req.params.id)) return send(res, 404, 'User not found', null);
                var user = await User.findById(req.params.id);
                if (!user) return send(res, 404, 'User not found', null);
                var data = user.toObject();
                await Task.updateMany(
                    { assignedUser: String(user._id) },
                    { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
                );
                await user.deleteOne();
                send(res, 200, 'OK', data);
            } catch (err) {
                if (!res.headersSent) send(res, 500, 'Something went wrong', null);
            }
        });

    return router;
};
