const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { putItem, getItem, updateItem, deleteItem, queryItems, scanItems } = require('../config/dynamodb');
const { setCache, getCache, deleteCache, CACHE_KEYS } = require('../config/redis');
const User = require('../models/mongodb/User');

const router = express.Router();
const BOOKMARKS_TABLE = process.env.DYNAMODB_BOOKMARKS_TABLE || 'networkx-bookmarks';

// POST /api/bookmarks/toggle - Bookmark/unbookmark content
router.post('/toggle', authenticateToken, [
  body('contentType').isIn(['post', 'project', 'club', 'event']).withMessage('Invalid content type'),
  body('contentId').notEmpty().withMessage('Content ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { contentType, contentId } = req.body;
    const userId = req.user.id;

    // Check if bookmark already exists
    const existingBookmarks = await queryItems(
      BOOKMARKS_TABLE,
      'userId = :userId AND contentId = :contentId',
      { 
        ':userId': userId,
        ':contentId': contentId
      }
    );

    if (existingBookmarks.length > 0) {
      // Remove bookmark
      await deleteItem(BOOKMARKS_TABLE, { 
        userId, 
        bookmarkId: existingBookmarks[0].bookmarkId 
      });

      // Clear cache
      await deleteCache(`bookmarks:${userId}`);

      res.json({
        message: 'Bookmark removed successfully',
        bookmarked: false,
        contentId,
        contentType
      });
    } else {
      // Add bookmark
      const bookmarkId = uuidv4();
      
      const bookmark = {
        bookmarkId,
        userId,
        contentType,
        contentId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await putItem(BOOKMARKS_TABLE, bookmark);

      // Clear cache
      await deleteCache(`bookmarks:${userId}`);

      res.json({
        message: 'Content bookmarked successfully',
        bookmarked: true,
        bookmark,
        contentId,
        contentType
      });
    }
  } catch (error) {
    console.error('Toggle bookmark error:', error);
    res.status(500).json({ error: 'Failed to toggle bookmark' });
  }
});

// GET /api/bookmarks - Get user bookmarks
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { contentType, page = 1, limit = 20 } = req.query;
    const userId = req.user.id;
    const cacheKey = `bookmarks:${userId}:${contentType || 'all'}:${page}`;
    
    // Try cache first
    const cachedBookmarks = await getCache(cacheKey);
    if (cachedBookmarks) {
      return res.json(cachedBookmarks);
    }

    // Get user bookmarks
    let bookmarks = await queryItems(
      BOOKMARKS_TABLE,
      'userId = :userId',
      { ':userId': userId }
    );

    // Apply content type filter
    if (contentType) {
      bookmarks = bookmarks.filter(bookmark => bookmark.contentType === contentType);
    }

    // Sort by creation date (newest first)
    bookmarks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Pagination
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const paginatedBookmarks = bookmarks.slice(startIndex, startIndex + parseInt(limit));

    // Get content details for each bookmark
    const bookmarksWithContent = await Promise.all(
      paginatedBookmarks.map(async (bookmark) => {
        let content = null;
        
        try {
          // Get content from appropriate table based on contentType
          const contentTable = `networkx-${bookmark.contentType}s`; // posts, projects, clubs, events
          const contentItems = await queryItems(
            contentTable,
            `${bookmark.contentType}Id = :contentId`,
            { ':contentId': bookmark.contentId }
          );
          
          if (contentItems.length > 0) {
            content = contentItems[0];
            
            // Get author details if available
            if (content.authorId || content.createdBy) {
              const authorId = content.authorId || content.createdBy;
              const author = await User.findById(authorId).select('firstName lastName username profileImage');
              content.author = author;
            }
          }
        } catch (contentError) {
          console.error(`Error fetching ${bookmark.contentType} content:`, contentError);
        }

        return {
          ...bookmark,
          content
        };
      })
    );

    const result = {
      bookmarks: bookmarksWithContent,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: bookmarks.length,
        pages: Math.ceil(bookmarks.length / parseInt(limit))
      },
      stats: {
        total: bookmarks.length,
        byType: {
          posts: bookmarks.filter(b => b.contentType === 'post').length,
          projects: bookmarks.filter(b => b.contentType === 'project').length,
          clubs: bookmarks.filter(b => b.contentType === 'club').length,
          events: bookmarks.filter(b => b.contentType === 'event').length
        }
      }
    };

    // Cache for 5 minutes
    await setCache(cacheKey, result, 300);
    
    res.json(result);
  } catch (error) {
    console.error('Get bookmarks error:', error);
    res.status(500).json({ error: 'Failed to fetch bookmarks' });
  }
});

// DELETE /api/bookmarks/:id - Delete a specific bookmark
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Check if bookmark exists and belongs to user
    const bookmarks = await queryItems(
      BOOKMARKS_TABLE,
      'bookmarkId = :bookmarkId',
      { ':bookmarkId': id }
    );
    
    if (bookmarks.length === 0) {
      return res.status(404).json({ error: 'Bookmark not found' });
    }

    const bookmark = bookmarks[0];
    
    if (bookmark.userId !== userId) {
      return res.status(403).json({ error: 'Access denied. You can only delete your own bookmarks.' });
    }

    await deleteItem(BOOKMARKS_TABLE, { 
      userId, 
      bookmarkId: id 
    });

    // Clear cache
    await deleteCache(`bookmarks:${userId}*`);

    res.json({ 
      message: 'Bookmark deleted successfully',
      bookmarkId: id
    });
  } catch (error) {
    console.error('Delete bookmark error:', error);
    res.status(500).json({ error: 'Failed to delete bookmark' });
  }
});

// DELETE /api/bookmarks/clear-all - Clear all user bookmarks
router.delete('/clear-all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get all user bookmarks
    const bookmarks = await queryItems(
      BOOKMARKS_TABLE,
      'userId = :userId',
      { ':userId': userId }
    );
    
    if (bookmarks.length === 0) {
      return res.json({ message: 'No bookmarks to clear' });
    }

    // Delete each bookmark
    const deletePromises = bookmarks.map(bookmark => 
      deleteItem(BOOKMARKS_TABLE, { 
        userId, 
        bookmarkId: bookmark.bookmarkId 
      })
    );

    await Promise.all(deletePromises);

    // Clear cache
    await deleteCache(`bookmarks:${userId}*`);

    res.json({ 
      message: `Cleared ${bookmarks.length} bookmarks`,
      count: bookmarks.length
    });
  } catch (error) {
    console.error('Clear all bookmarks error:', error);
    res.status(500).json({ error: 'Failed to clear all bookmarks' });
  }
});

// GET /api/bookmarks/check/:contentType/:contentId - Check if content is bookmarked
router.get('/check/:contentType/:contentId', authenticateToken, async (req, res) => {
  try {
    const { contentType, contentId } = req.params;
    const userId = req.user.id;

    if (!['post', 'project', 'club', 'event'].includes(contentType)) {
      return res.status(400).json({ error: 'Invalid content type' });
    }

    // Check if bookmark exists
    const bookmarks = await queryItems(
      BOOKMARKS_TABLE,
      'userId = :userId AND contentId = :contentId',
      { 
        ':userId': userId,
        ':contentId': contentId
      }
    );

    res.json({
      bookmarked: bookmarks.length > 0,
      contentType,
      contentId
    });
  } catch (error) {
    console.error('Check bookmark error:', error);
    res.status(500).json({ error: 'Failed to check bookmark status' });
  }
});

// GET /api/bookmarks/stats - Get bookmark statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKey = `bookmarks:stats:${userId}`;
    
    // Try cache first
    const cachedStats = await getCache(cacheKey);
    if (cachedStats) {
      return res.json(cachedStats);
    }

    // Get all user bookmarks
    const bookmarks = await queryItems(
      BOOKMARKS_TABLE,
      'userId = :userId',
      { ':userId': userId }
    );

    const stats = {
      total: bookmarks.length,
      byType: {
        posts: bookmarks.filter(b => b.contentType === 'post').length,
        projects: bookmarks.filter(b => b.contentType === 'project').length,
        clubs: bookmarks.filter(b => b.contentType === 'club').length,
        events: bookmarks.filter(b => b.contentType === 'event').length
      },
      recentActivity: {
        thisWeek: bookmarks.filter(b => {
          const bookmarkDate = new Date(b.createdAt);
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          return bookmarkDate >= weekAgo;
        }).length,
        thisMonth: bookmarks.filter(b => {
          const bookmarkDate = new Date(b.createdAt);
          const monthAgo = new Date();
          monthAgo.setMonth(monthAgo.getMonth() - 1);
          return bookmarkDate >= monthAgo;
        }).length
      }
    };

    // Cache for 10 minutes
    await setCache(cacheKey, stats, 600);
    
    res.json(stats);
  } catch (error) {
    console.error('Get bookmark stats error:', error);
    res.status(500).json({ error: 'Failed to get bookmark statistics' });
  }
});

module.exports = router;
