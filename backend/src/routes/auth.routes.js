'use strict';
const router = require('express').Router();
const validate = require('../middlewares/validate');
const { authenticate } = require('../middlewares/auth');
const { authLimiter } = require('../middlewares/rateLimit');
const v = require('../validators/auth.validator');
const c = require('../controllers/auth.controller');

router.post('/register', authLimiter, validate({ body: v.register }), c.register);
router.post('/login', authLimiter, validate({ body: v.login }), c.login);
router.post('/refresh', validate({ body: v.refresh }), c.refresh);
router.post('/logout', c.logout);

router.get('/me', authenticate, c.me);
router.patch('/me/profile', authenticate, validate({ body: v.profileInput }), c.updateMyProfile);
router.post('/me/change-password', authenticate, validate({ body: v.changePassword }), c.changePassword);

module.exports = router;
