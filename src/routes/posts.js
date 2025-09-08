const express = require('express');
const { Post, User } = require('../models');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/posts
router.get('/', authenticateToken, async (req, res) => {
  try {
    const posts = await Post.findAll({
      where: { isPublic: true },
      include: [{
        model: User,
        as: 'author',
        attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage']
      }],
      order: [['createdAt', 'DESC']]
    });
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

module.exports = router;
