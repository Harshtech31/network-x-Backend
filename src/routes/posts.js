const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { uploadMiddleware } = require('../config/aws');
const { putItem, getItem, updateItem, deleteItem, queryItems, scanItems } = require('../config/dynamodb');
const { setCache, getCache, deleteCache, CACHE_KEYS, invalidatePostCache } = require('../config/redis');
const User = require('../models/mongodb/User');
const RealtimeService = require('../services/realtime');

const router = express.Router();
const POSTS_TABLE = process.env.DYNAMODB_POSTS_TABLE || 'networkx-posts';

// GET /api/posts - Get all posts with pagination
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const cacheKey = `posts:all:${page}:${limit}`;
    
    // Try cache first
    const cachedPosts = await getCache(cacheKey);
    if (cachedPosts) {
      return res.json(cachedPosts);
    }

    // Get posts from DynamoDB
    const posts = await scanItems(POSTS_TABLE, null, {}, parseInt(limit));
    
    // Get user details for each post
    const postsWithUsers = await Promise.all(
      posts.map(async (post) => {
        const user = await User.findById(post.userId).select('firstName lastName username profileImage');
        return {
          ...post,
          author: user
        };
      })
    );

    // Sort by creation date (newest first)
    postsWithUsers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const result = {
      posts: postsWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: postsWithUsers.length
      }
    };

    // Cache for 5 minutes
    await setCache(cacheKey, result, 300);
    
    res.json(result);
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// POST /api/posts - Create new post
router.post('/', authenticateToken, uploadMiddleware.postMedia, async (req, res) => {
  try {
    const { content, tags, location, visibility = 'public' } = req.body;
    const postId = uuidv4();
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Post content is required' });
    }

    const mediaUrls = req.files ? req.files.map(file => file.location) : [];
    
    const post = {
      postId,
      userId: req.user.id,
      content: content.trim(),
      mediaUrls,
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      location: location || null,
      visibility,
      likes: 0,
      comments: 0,
      shares: 0,
      likedBy: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putItem(POSTS_TABLE, post);

    // Get user details
    const user = await User.findById(req.user.id).select('firstName lastName username profileImage');
    
    const responsePost = {
      ...post,
      author: user
    };

    // Invalidate cache
    await invalidatePostCache(postId, req.user.id);

    res.status(201).json({
      message: 'Post created successfully',
      post: responsePost
    });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// GET /api/posts/:id - Get specific post
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = CACHE_KEYS.POST_DETAILS(id);
    
    // Try cache first
    const cachedPost = await getCache(cacheKey);
    if (cachedPost) {
      return res.json(cachedPost);
    }

    const post = await getItem(POSTS_TABLE, { postId: id });
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Get user details
    const user = await User.findById(post.userId).select('firstName lastName username profileImage');
    
    const responsePost = {
      ...post,
      author: user
    };

    // Cache for 10 minutes
    await setCache(cacheKey, responsePost, 600);
    
    res.json(responsePost);
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// PUT /api/posts/:id - Update post
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, tags, location, visibility } = req.body;
    
    const post = await getItem(POSTS_TABLE, { postId: id });
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to update this post' });
    }

    const updateExpression = 'SET #content = :content, #tags = :tags, #location = :location, #visibility = :visibility, #updatedAt = :updatedAt';
    const expressionAttributeNames = {
      '#content': 'content',
      '#tags': 'tags',
      '#location': 'location',
      '#visibility': 'visibility',
      '#updatedAt': 'updatedAt'
    };
    const expressionAttributeValues = {
      ':content': content.trim(),
      ':tags': tags ? tags.split(',').map(tag => tag.trim()) : post.tags,
      ':location': location || post.location,
      ':visibility': visibility || post.visibility,
      ':updatedAt': new Date().toISOString()
    };

    const updatedPost = await updateItem(
      POSTS_TABLE,
      { postId: id },
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    );

    // Get user details
    const user = await User.findById(req.user.id).select('firstName lastName username profileImage');
    
    const responsePost = {
      ...updatedPost,
      author: user
    };

    // Invalidate cache
    await invalidatePostCache(id, req.user.id);

    res.json({
      message: 'Post updated successfully',
      post: responsePost
    });
  } catch (error) {
    console.error('Update post error:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// DELETE /api/posts/:id - Delete post
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const post = await getItem(POSTS_TABLE, { postId: id });
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }

    await deleteItem(POSTS_TABLE, { postId: id });

    // Invalidate cache
    await invalidatePostCache(id, req.user.id);

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// POST /api/posts/:id/like - Like/unlike post
router.post('/:id/like', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const post = await getItem(POSTS_TABLE, { postId: id });
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const likedBy = post.likedBy || [];
    const isLiked = likedBy.includes(userId);
    
    let updateExpression, expressionAttributeValues;
    
    if (isLiked) {
      // Unlike
      const newLikedBy = likedBy.filter(id => id !== userId);
      updateExpression = 'SET likedBy = :likedBy, likes = :likes, updatedAt = :updatedAt';
      expressionAttributeValues = {
        ':likedBy': newLikedBy,
        ':likes': Math.max(0, post.likes - 1),
        ':updatedAt': new Date().toISOString()
      };
    } else {
      // Like
      const newLikedBy = [...likedBy, userId];
      updateExpression = 'SET likedBy = :likedBy, likes = :likes, updatedAt = :updatedAt';
      expressionAttributeValues = {
        ':likedBy': newLikedBy,
        ':likes': post.likes + 1,
        ':updatedAt': new Date().toISOString()
      };
    }

    const updatedPost = await updateItem(
      POSTS_TABLE,
      { postId: id },
      updateExpression,
      expressionAttributeValues
    );

    // Invalidate cache
    await deleteCache(CACHE_KEYS.POST_DETAILS(id));

    // Send real-time notification
    await RealtimeService.handlePostInteraction(
      id, 
      post.userId, 
      'like', 
      req.user, 
      { liked: !isLiked }
    );

    res.json({
      message: isLiked ? 'Post unliked' : 'Post liked',
      liked: !isLiked,
      likes: updatedPost.likes
    });
  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({ error: 'Failed to like/unlike post' });
  }
});

// POST /api/posts/:id/comment - Add comment to post
router.post('/:id/comment', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    const post = await getItem(POSTS_TABLE, { postId: id });
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const commentId = uuidv4();
    const comment = {
      commentId,
      userId: req.user.id,
      content: content.trim(),
      createdAt: new Date().toISOString()
    };

    const comments = post.comments_data || [];
    comments.push(comment);

    const updateExpression = 'SET comments_data = :comments, comments = :commentCount, updatedAt = :updatedAt';
    const expressionAttributeValues = {
      ':comments': comments,
      ':commentCount': comments.length,
      ':updatedAt': new Date().toISOString()
    };

    await updateItem(
      POSTS_TABLE,
      { postId: id },
      updateExpression,
      expressionAttributeValues
    );

    // Get user details
    const user = await User.findById(req.user.id).select('firstName lastName username profileImage');
    
    const responseComment = {
      ...comment,
      author: user
    };

    // Invalidate cache
    await deleteCache(CACHE_KEYS.POST_DETAILS(id));
    await deleteCache(CACHE_KEYS.POST_COMMENTS(id, 1));

    // Send real-time notification
    await RealtimeService.handlePostInteraction(
      id, 
      post.userId, 
      'comment', 
      req.user, 
      { comment: responseComment }
    );

    res.status(201).json({
      message: 'Comment added successfully',
      comment: responseComment
    });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// GET /api/posts/:id/comments - Get post comments
router.get('/:id/comments', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const cacheKey = CACHE_KEYS.POST_COMMENTS(id, page);
    
    // Try cache first
    const cachedComments = await getCache(cacheKey);
    if (cachedComments) {
      return res.json(cachedComments);
    }

    const post = await getItem(POSTS_TABLE, { postId: id });
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const comments = post.comments_data || [];
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);
    const paginatedComments = comments.slice(startIndex, endIndex);

    // Get user details for each comment
    const commentsWithUsers = await Promise.all(
      paginatedComments.map(async (comment) => {
        const user = await User.findById(comment.userId).select('firstName lastName username profileImage');
        return {
          ...comment,
          author: user
        };
      })
    );

    const result = {
      comments: commentsWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: comments.length,
        pages: Math.ceil(comments.length / parseInt(limit))
      }
    };

    // Cache for 5 minutes
    await setCache(cacheKey, result, 300);
    
    res.json(result);
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// GET /api/posts/user/:userId - Get user posts
router.get('/user/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const cacheKey = CACHE_KEYS.USER_POSTS(userId, page);
    
    // Try cache first
    const cachedPosts = await getCache(cacheKey);
    if (cachedPosts) {
      return res.json(cachedPosts);
    }

    const posts = await queryItems(
      POSTS_TABLE,
      'userId = :userId',
      { ':userId': userId },
      'UserPostsIndex',
      parseInt(limit)
    );

    // Get user details
    const user = await User.findById(userId).select('firstName lastName username profileImage');
    
    const postsWithUser = posts.map(post => ({
      ...post,
      author: user
    }));

    const result = {
      posts: postsWithUser,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: postsWithUser.length
      }
    };

    // Cache for 5 minutes
    await setCache(cacheKey, result, 300);
    
    res.json(result);
  } catch (error) {
    console.error('Get user posts error:', error);
    res.status(500).json({ error: 'Failed to fetch user posts' });
  }
});

module.exports = router;
