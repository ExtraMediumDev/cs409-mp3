function send(res, status, message, data) {
    res.status(status).json({ message: message, data: data });
}

function isObjectId(id) {
    return typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id);
}

function readListQuery(req, res) {
    var query = { count: req.query.count === 'true' };
    var keys = ['where', 'sort', 'select'];

    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (req.query[key] === undefined) continue;
        var parsed;
        try {
            parsed = JSON.parse(req.query[key]);
        } catch (err) {
            send(res, 400, 'Invalid ' + key, null);
            return null;
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            send(res, 400, 'Invalid ' + key, null);
            return null;
        }
        query[key] = parsed;
    }

    if (req.query.skip !== undefined) {
        var skip = Number(req.query.skip);
        if (!Number.isFinite(skip) || skip < 0) {
            send(res, 400, 'Invalid skip', null);
            return null;
        }
        query.skip = skip;
    }

    if (req.query.limit !== undefined) {
        var limit = Number(req.query.limit);
        if (!Number.isFinite(limit) || limit < 0) {
            send(res, 400, 'Invalid limit', null);
            return null;
        }
        query.limit = limit;
    }

    return query;
}

async function listDocuments(Model, req, res, defaultLimit) {
    var query = readListQuery(req, res);
    if (!query) return;

    try {
        if (query.count) {
            var count = await Model.countDocuments(query.where || {});
            return send(res, 200, 'OK', count);
        }

        var limit = query.limit !== undefined ? query.limit : defaultLimit;
        if (limit === 0) return send(res, 200, 'OK', []);

        var finder = Model.find(query.where || {});
        if (query.sort) finder = finder.sort(query.sort);
        if (query.select) finder = finder.select(query.select);
        if (query.skip !== undefined) finder = finder.skip(query.skip);
        if (limit !== undefined) finder = finder.limit(limit);

        var docs = await finder;
        return send(res, 200, 'OK', docs);
    } catch (err) {
        return send(res, 500, 'Something went wrong', null);
    }
}

async function getOne(Model, req, res, label) {
    var select = null;

    if (req.query.select !== undefined) {
        try {
            select = JSON.parse(req.query.select);
        } catch (err) {
            return send(res, 400, 'Invalid select', null);
        }
        if (select === null || typeof select !== 'object' || Array.isArray(select)) {
            return send(res, 400, 'Invalid select', null);
        }
    }

    if (!isObjectId(req.params.id)) {
        return send(res, 404, label + ' not found', null);
    }

    try {
        var finder = Model.findById(req.params.id);
        if (select) finder = finder.select(select);
        var doc = await finder;
        if (!doc) return send(res, 404, label + ' not found', null);
        return send(res, 200, 'OK', doc);
    } catch (err) {
        if (err.name === 'CastError') return send(res, 404, label + ' not found', null);
        return send(res, 500, 'Something went wrong', null);
    }
}

module.exports = {
    send: send,
    isObjectId: isObjectId,
    listDocuments: listDocuments,
    getOne: getOne
};
