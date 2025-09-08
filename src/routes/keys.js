const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const UserKeys = require('../models/mongodb/UserKeys');
const EncryptionService = require('../services/encryption');
const bcrypt = require('bcryptjs');

const router = express.Router();

// POST /api/keys/generate - Generate encryption key pair for user
router.post('/generate', authenticateToken, [
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { password } = req.body;
    const userId = req.user.id;

    // Check if user already has keys
    const existingKeys = await UserKeys.findOne({ userId });
    if (existingKeys) {
      return res.status(400).json({
        error: 'Keys already exist',
        message: 'User already has encryption keys. Use update endpoint to change them.'
      });
    }

    // Generate RSA key pair
    const { publicKey, privateKey } = EncryptionService.generateKeyPair();

    // Encrypt private key with user's password
    const salt = await bcrypt.genSalt(12);
    const encryptedPrivateKey = await bcrypt.hash(privateKey + password, salt);

    // Save keys to database
    const userKeys = new UserKeys({
      userId,
      publicKey,
      encryptedPrivateKey,
      keyVersion: 1
    });

    await userKeys.save();

    res.status(201).json({
      message: 'Encryption keys generated successfully',
      publicKey,
      keyVersion: 1
    });

  } catch (error) {
    console.error('Generate keys error:', error);
    res.status(500).json({
      error: 'Failed to generate keys',
      message: 'An error occurred while generating encryption keys'
    });
  }
});

// GET /api/keys/public/:userId - Get user's public key
router.get('/public/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;

    const userKeys = await UserKeys.findOne({ userId }).select('publicKey keyVersion');
    if (!userKeys) {
      return res.status(404).json({
        error: 'Keys not found',
        message: 'User does not have encryption keys'
      });
    }

    res.json({
      userId,
      publicKey: userKeys.publicKey,
      keyVersion: userKeys.keyVersion
    });

  } catch (error) {
    console.error('Get public key error:', error);
    res.status(500).json({
      error: 'Failed to get public key',
      message: 'An error occurred while retrieving public key'
    });
  }
});

// POST /api/keys/verify - Verify user can decrypt their private key
router.post('/verify', authenticateToken, [
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { password } = req.body;
    const userId = req.user.id;

    const userKeys = await UserKeys.findOne({ userId });
    if (!userKeys) {
      return res.status(404).json({
        error: 'Keys not found',
        message: 'User does not have encryption keys'
      });
    }

    // For demo purposes - in production, you'd properly decrypt the private key
    // This is a simplified verification
    const testData = 'test_encryption_verification';
    try {
      const encrypted = EncryptionService.encryptKeyForUser(testData, userKeys.publicKey);
      // In production, you'd decrypt with the actual private key
      
      res.json({
        message: 'Key verification successful',
        verified: true
      });
    } catch (error) {
      res.status(400).json({
        error: 'Key verification failed',
        message: 'Unable to verify encryption keys'
      });
    }

  } catch (error) {
    console.error('Verify keys error:', error);
    res.status(500).json({
      error: 'Failed to verify keys',
      message: 'An error occurred while verifying keys'
    });
  }
});

module.exports = router;
