const express = require("express");
const router  = express.Router();
const { auth } = require("../middleware/auth");
const c = require("../controllers/authController");

router.post("/register",             c.register);
router.get ("/verify/:token",        c.verifyEmail);
router.post("/login",                c.login);
router.get ("/me",           auth,   c.me);
router.put ("/profile",      auth,   c.updateProfile);
router.put ("/password",     auth,   c.changePassword);
router.post("/forgot-password",      c.forgotPassword);
router.post("/reset-password",       c.resetPassword);
router.post("/resend-verification",  c.resendVerification);

module.exports = router;