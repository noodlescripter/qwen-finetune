/**
 * API route handlers.
 */

const express = require('express');
const { validateEmail, validatePassword, validateUsername, combineValidations } = require('../utils/validator');

const router = express.Router();

/**
 * Middleware to handle async route errors.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Middleware to validate request body.
 */
function validateBody(validator) {
  return (req, res, next) => {
    const result = validator(req.body);
    if (!result.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.errors,
      });
    }
    next();
  };
}

/**
 * Health check endpoint.
 * GET /api/health
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * User registration endpoint.
 * POST /api/register
 */
router.post(
  '/register',
  validateBody((body) =>
    combineValidations(
      validateEmail(body.email),
      validateUsername(body.username),
      validatePassword(body.password)
    )
  ),
  asyncHandler(async (req, res) => {
    const { email, username, password } = req.body;

    // Check if user exists (mock implementation)
    const existingUser = null; // await userService.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Create user (mock implementation)
    const user = {
      id: Date.now().toString(),
      email,
      username,
      createdAt: new Date().toISOString(),
    };

    res.status(201).json({
      message: 'User registered successfully',
      user,
    });
  })
);

/**
 * User login endpoint.
 * POST /api/login
 */
router.post(
  '/login',
  validateBody((body) => combineValidations(validateEmail(body.email), validatePassword(body.password))),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    // Authenticate user (mock implementation)
    const token = 'mock-jwt-token-' + Date.now();

    res.json({
      message: 'Login successful',
      token,
      expiresIn: 3600,
    });
  })
);

/**
 * Get current user endpoint.
 * GET /api/me
 */
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Mock user data
    const user = {
      id: '1',
      email: 'user@example.com',
      username: 'testuser',
      createdAt: new Date().toISOString(),
    };

    res.json({ user });
  })
);

/**
 * Update user profile endpoint.
 * PATCH /api/me
 */
router.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { username } = req.body;
    if (username) {
      const validation = validateUsername(username);
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.errors,
        });
      }
    }

    // Mock updated user
    const user = {
      id: '1',
      email: 'user@example.com',
      username: username || 'testuser',
      updatedAt: new Date().toISOString(),
    };

    res.json({
      message: 'Profile updated',
      user,
    });
  })
);

/**
 * List users endpoint (admin only).
 * GET /api/users
 */
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, search } = req.query;

    // Mock user list
    const users = [
      { id: '1', username: 'user1', email: 'user1@example.com' },
      { id: '2', username: 'user2', email: 'user2@example.com' },
    ];

    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: users.length,
        totalPages: 1,
      },
    });
  })
);

/**
 * Error handling middleware.
 */
router.use((err, req, res, next) => {
  console.error('API Error:', err);

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

module.exports = router;
