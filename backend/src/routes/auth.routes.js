const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { EXPERIENCE_LEVELS } = require('../constants/experienceLevels');
const { protect, verifyAdminKey, requireRole } = require('../middleware/auth.middleware');
const { sendOnboardingEmail } = require('../utils/mailer');

const generateTempPassword = () => {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*';
  const all = lowercase + uppercase + numbers + symbols;

  let password = '';
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];

  for (let i = 0; i < 8; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }

  return password.split('').sort(() => 0.5 - Math.random()).join('');
};

const router = express.Router();

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// POST /api/auth/verify-key
router.post('/verify-key', verifyAdminKey, (req, res) => {
  res.json({ success: true, message: 'Key verified' });
});

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, role, domain, experience, adminKey } = req.body;

    const isRegistrationAdmin = role === 'admin';
    if (!name || !email || (isRegistrationAdmin && !password)) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    // Role Assignment with Secret Key Verification
    let userRole = 'candidate';
    if (role === 'admin') {
      const secret = process.env.ADMIN_REGISTRATION_KEY || 'FALLBACK_SECRET_CHANGE_ME';
      if (!adminKey || adminKey !== secret) {
        return res.status(403).json({ success: false, message: 'Invalid Admin Registration Key' });
      }
      userRole = 'admin';
    }

    let experienceValue = null;
    if (userRole === 'candidate') {
      if (experience === undefined || experience === null || String(experience).trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Years of experience is required for candidate accounts',
        });
      }
      experienceValue = String(experience).trim();
      if (!EXPERIENCE_LEVELS.includes(experienceValue)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid experience level',
        });
      }
    }

    // Candidates get a secure random password placeholder since admin will distribute it
    const crypto = require('crypto');
    const finalPassword = isRegistrationAdmin ? password : crypto.randomBytes(16).toString('hex');

    const user = await User.create({
      name,
      email,
      password: finalPassword,
      role: userRole,
      domain: userRole === 'candidate' ? domain : null,
      experience: experienceValue,
      status: userRole === 'admin' ? 'approved' : 'pending',
    });

    res.status(201).json({
      success: true,
      message: userRole === 'admin' 
        ? 'Admin registered successfully. You can now login.' 
        : 'Registration successful. Your account is pending admin approval. You will receive your credentials via email once approved.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Your account is deactivated' });
    }

    if (user.role === 'candidate' && user.status !== 'approved') {
      const msg = user.status === 'pending'
        ? 'Your account is waiting for admin approval'
        : 'Your account has been rejected';
      return res.status(403).json({ success: false, message: msg });
    }

    // Candidates have a strict 24-hour access window from the moment credentials are sent/updated
    if (user.role === 'candidate') {
      if (user.temporaryPasswordExpiresAt && new Date() > user.temporaryPasswordExpiresAt) {
        return res.status(403).json({ 
          success: false, 
          message: 'Your access credentials have expired (24-hour limit). Please contact the administrator for a new link.' 
        });
      }
    }

    const token = signToken(user._id);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        domain: user.domain,
        experience: user.experience,
        status: user.status
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me
router.get('/me', protect, async (req, res, next) => {
  try {
    res.json({
      success: true,
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        domain: req.user.domain,
        experience: req.user.experience,
        status: req.user.status
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/trainees - List all trainees (candidates)
router.get('/trainees', protect, requireRole('admin'), async (req, res, next) => {
  try {
    const trainees = await User.find({ role: 'candidate' }).sort({ createdAt: -1 });
    res.json({ success: true, data: trainees });
  } catch (error) {
    next(error);
  }
});

// PUT /api/auth/trainees/:id/status - Approve or reject a trainee
router.put('/trainees/:id/status', protect, requireRole('admin'), async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const trainee = await User.findById(req.params.id);
    if (!trainee || trainee.role !== 'candidate') {
      return res.status(404).json({ success: false, message: 'Trainee not found' });
    }
    trainee.status = status;
    await trainee.save();
    res.json({ success: true, message: `Trainee status updated to ${status}`, data: trainee });
  } catch (error) {
    next(error);
  }
});

// PUT /api/auth/trainees/:id/credentials - Edit credentials and activate/deactivate trainee access
router.put('/trainees/:id/credentials', protect, requireRole('admin'), async (req, res, next) => {
  try {
    const { email, password, isActive, status } = req.body;
    const trainee = await User.findById(req.params.id);
    if (!trainee || trainee.role !== 'candidate') {
      return res.status(404).json({ success: false, message: 'Trainee not found' });
    }

    if (email) {
      const existingUser = await User.findOne({ email, _id: { $ne: trainee._id } });
      if (existingUser) {
        return res.status(409).json({ success: false, message: 'Email already in use' });
      }
      trainee.email = email;
    }

    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
      }
      trainee.password = password;
    }

    if (isActive !== undefined) {
      trainee.isActive = isActive;
    }

    if (status) {
      if (!['pending', 'approved', 'rejected'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status' });
      }
      trainee.status = status;
    }

    await trainee.save();
    res.json({ success: true, message: 'Trainee updated successfully', data: trainee });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/trainees/:id/approve-credentials - Approve & send credentials
router.post('/trainees/:id/approve-credentials', protect, requireRole('admin'), async (req, res, next) => {
  try {
    const trainee = await User.findById(req.params.id);
    if (!trainee || trainee.role !== 'candidate') {
      return res.status(404).json({ success: false, message: 'Trainee not found' });
    }

    const tempPassword = generateTempPassword();
    trainee.password = tempPassword;
    trainee.status = 'approved';
    trainee.isTemporaryPassword = true;
    trainee.temporaryPasswordExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    trainee.isActive = true; // account activation flow

    await trainee.save();

    // Automatically send email containing credentials
    let emailSent = false;
    let emailError = null;
    try {
      await sendOnboardingEmail(trainee.email, trainee.name, tempPassword);
      emailSent = true;
    } catch (err) {
      console.error('❌ Failed to send onboarding email:', err);
      emailError = err.message;
    }

    res.json({
      success: true,
      message: emailSent
        ? `Credentials sent successfully to ${trainee.email}`
        : `Trainee approved, but email delivery failed (${emailError}). Temporary password: ${tempPassword}`,
      data: {
        id: trainee._id,
        status: trainee.status,
        isTemporaryPassword: trainee.isTemporaryPassword,
        isActive: trainee.isActive,
        tempPassword: emailSent ? undefined : tempPassword
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/change-password - First-login password reset
router.post('/change-password', protect, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Verify current password first
    if (!(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ success: false, message: 'Invalid current password' });
    }

    user.password = newPassword;
    user.isTemporaryPassword = false;
    await user.save();

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/auth/trainees/:id - Delete a trainee and their applications
router.delete('/trainees/:id', protect, requireRole('admin'), async (req, res, next) => {
  try {
    const trainee = await User.findById(req.params.id);
    if (!trainee || trainee.role !== 'candidate') {
      return res.status(404).json({ success: false, message: 'Trainee not found' });
    }

    // Delete trainee's applications
    const Application = require('../models/Application');
    await Application.deleteMany({ candidateId: trainee._id });

    // Delete trainee
    await User.findByIdAndDelete(trainee._id);

    res.json({ success: true, message: 'Trainee and all related applications deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
