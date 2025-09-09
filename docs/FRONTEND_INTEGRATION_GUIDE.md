# Network-X Frontend Integration Guide

## 🔌 **API Integration Overview**

### Base Configuration
```javascript
// Frontend API configuration
const API_CONFIG = {
  BASE_URL: 'http://localhost:5000/api', // Update for production
  SOCKET_URL: 'http://localhost:5000',   // Update for production
  TIMEOUT: 10000,
  HEADERS: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
};
```

## 🔐 **Authentication Integration**

### 1. Login Flow
```javascript
// POST /api/auth/login
const login = async (email, password) => {
  const response = await fetch(`${API_CONFIG.BASE_URL}/auth/login`, {
    method: 'POST',
    headers: API_CONFIG.HEADERS,
    body: JSON.stringify({ email, password })
  });
  
  const data = await response.json();
  if (data.token) {
    // Store token securely
    await AsyncStorage.setItem('authToken', data.token);
    await AsyncStorage.setItem('user', JSON.stringify(data.user));
  }
  return data;
};
```

### 2. Registration Flow
```javascript
// POST /api/auth/register
const register = async (userData) => {
  const response = await fetch(`${API_CONFIG.BASE_URL}/auth/register`, {
    method: 'POST',
    headers: API_CONFIG.HEADERS,
    body: JSON.stringify(userData)
  });
  return response.json();
};
```

### 3. Authenticated Requests
```javascript
const getAuthHeaders = async () => {
  const token = await AsyncStorage.getItem('authToken');
  return {
    ...API_CONFIG.HEADERS,
    'Authorization': `Bearer ${token}`
  };
};
```

## 👤 **User Profile Integration**

### Profile Management
```javascript
// GET /api/users/profile
const getUserProfile = async () => {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_CONFIG.BASE_URL}/users/profile`, {
    headers
  });
  return response.json();
};

// PUT /api/users/profile
const updateProfile = async (profileData) => {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_CONFIG.BASE_URL}/users/profile`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(profileData)
  });
  return response.json();
};

// POST /api/users/follow/:userId
const toggleFollow = async (userId) => {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_CONFIG.BASE_URL}/users/follow/${userId}`, {
    method: 'POST',
    headers
  });
  return response.json();
};
```

## 📱 **Content Management Integration**

### Posts
```javascript
// GET /api/posts
const getPosts = async (page = 1, limit = 20) => {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${API_CONFIG.BASE_URL}/posts?page=${page}&limit=${limit}`,
    { headers }
  );
  return response.json();
};

// POST /api/posts
const createPost = async (postData) => {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_CONFIG.BASE_URL}/posts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(postData)
  });
  return response.json();
};

// POST /api/posts/:id/like
const toggleLike = async (postId) => {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_CONFIG.BASE_URL}/posts/${postId}/like`, {
    method: 'POST',
    headers
  });
  return response.json();
};
```

### Projects
```javascript
// GET /api/projects
const getProjects = async (filters = {}) => {
  const headers = await getAuthHeaders();
  const queryParams = new URLSearchParams(filters).toString();
  const response = await fetch(
    `${API_CONFIG.BASE_URL}/projects?${queryParams}`,
    { headers }
  );
  return response.json();
};

// POST /api/projects
const createProject = async (projectData) => {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_CONFIG.BASE_URL}/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify(projectData)
  });
  return response.json();
};
```

## 💬 **Messaging Integration**

### End-to-End Encrypted Messaging
```javascript
// Generate encryption keys on signup
const generateUserKeys = async (password) => {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_CONFIG.BASE_URL}/keys/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ password })
  });
  return response.json();
};

// Send encrypted message
const sendMessage = async (conversationId, content, receiverId) => {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_CONFIG.BASE_URL}/messages/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      conversationId,
      content,
      receiverId,
      messageType: 'text'
    })
  });
  return response.json();
};

// Get conversation messages
const getMessages = async (conversationId, page = 1) => {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${API_CONFIG.BASE_URL}/messages/conversation/${conversationId}?page=${page}`,
    { headers }
  );
  return response.json();
};
```

## 🔔 **Notifications Integration**

### Push Notifications
```javascript
// Register push token
const registerPushToken = async (token, platform) => {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_CONFIG.BASE_URL}/notifications/register-token`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ token, platform })
  });
  return response.json();
};

// Get notifications
const getNotifications = async (page = 1) => {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${API_CONFIG.BASE_URL}/notifications?page=${page}`,
    { headers }
  );
  return response.json();
};

// Mark notification as read
const markNotificationRead = async (notificationId) => {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${API_CONFIG.BASE_URL}/notifications/${notificationId}/read`,
    { method: 'PUT', headers }
  );
  return response.json();
};
```

## ⚡ **Real-time Socket.IO Integration**

### Socket Connection Setup
```javascript
import socketService from './utils/socket';

// Initialize socket connection
const initializeSocket = async () => {
  const token = await AsyncStorage.getItem('authToken');
  if (token) {
    socketService.connect(token);
  }
};

// Listen for real-time events
useEffect(() => {
  // Message events
  socketService.onMessage((message) => {
    // Handle new message
    setMessages(prev => [...prev, message]);
  });

  // Notification events
  socketService.onNotification((notification) => {
    // Show notification
    showNotification(notification.title, notification.message);
  });

  // Presence events
  socketService.onUserOnline((data) => {
    // Update user online status
    updateUserStatus(data.userId, 'online');
  });

  // Post interaction events
  socketService.onPostInteraction((data) => {
    // Update post likes/comments in real-time
    updatePostInteraction(data.postId, data);
  });

  return () => {
    socketService.disconnect();
  };
}, []);
```

## 📁 **File Upload Integration**

### Image/Media Upload
```javascript
// Upload profile image
const uploadProfileImage = async (imageUri) => {
  const token = await AsyncStorage.getItem('authToken');
  const formData = new FormData();
  
  formData.append('profileImage', {
    uri: imageUri,
    type: 'image/jpeg',
    name: 'profile.jpg'
  });

  const response = await fetch(`${API_CONFIG.BASE_URL}/users/profile`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'multipart/form-data'
    },
    body: formData
  });
  
  return response.json();
};

// Upload post media
const uploadPostMedia = async (mediaFiles) => {
  const token = await AsyncStorage.getItem('authToken');
  const formData = new FormData();
  
  mediaFiles.forEach((file, index) => {
    formData.append('media', {
      uri: file.uri,
      type: file.type,
      name: `media_${index}.${file.extension}`
    });
  });

  const response = await fetch(`${API_CONFIG.BASE_URL}/upload/media`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'multipart/form-data'
    },
    body: formData
  });
  
  return response.json();
};
```

## 🔍 **Search Integration**

### Advanced Search
```javascript
// Search across all content
const searchContent = async (query, filters = {}) => {
  const headers = await getAuthHeaders();
  const searchParams = new URLSearchParams({
    q: query,
    ...filters
  }).toString();
  
  const response = await fetch(
    `${API_CONFIG.BASE_URL}/search?${searchParams}`,
    { headers }
  );
  return response.json();
};

// Get personalized feed
const getFeed = async (page = 1) => {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${API_CONFIG.BASE_URL}/feed?page=${page}`,
    { headers }
  );
  return response.json();
};
```

## 🔖 **Bookmarks Integration**

### Bookmark Management
```javascript
// Toggle bookmark
const toggleBookmark = async (contentType, contentId) => {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_CONFIG.BASE_URL}/bookmarks/toggle`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contentType, contentId })
  });
  return response.json();
};

// Get user bookmarks
const getBookmarks = async (contentType = null, page = 1) => {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ page });
  if (contentType) params.append('contentType', contentType);
  
  const response = await fetch(
    `${API_CONFIG.BASE_URL}/bookmarks?${params.toString()}`,
    { headers }
  );
  return response.json();
};
```

## 🚨 **Error Handling**

### Global Error Handler
```javascript
const handleApiError = (error, response) => {
  if (response?.status === 401) {
    // Token expired, redirect to login
    AsyncStorage.removeItem('authToken');
    navigation.navigate('Login');
  } else if (response?.status === 403) {
    // Access denied
    showAlert('Access Denied', 'You do not have permission to perform this action');
  } else if (response?.status >= 500) {
    // Server error
    showAlert('Server Error', 'Something went wrong. Please try again later.');
  } else {
    // Other errors
    showAlert('Error', error.message || 'An unexpected error occurred');
  }
};
```

## 📊 **State Management Integration**

### Redux/Context Integration
```javascript
// API service with state management
const apiService = {
  // User actions
  async loginUser(credentials) {
    try {
      const response = await login(credentials.email, credentials.password);
      dispatch(setUser(response.user));
      dispatch(setToken(response.token));
      return response;
    } catch (error) {
      dispatch(setError(error.message));
      throw error;
    }
  },

  // Real-time updates
  setupRealTimeListeners() {
    socketService.onMessage((message) => {
      dispatch(addMessage(message));
    });
    
    socketService.onNotification((notification) => {
      dispatch(addNotification(notification));
    });
  }
};
```

## ✅ **Integration Testing Checklist**

### Frontend-Backend Integration Tests
- [ ] User authentication flow
- [ ] Profile management
- [ ] Post creation and interactions
- [ ] Project management
- [ ] Club operations
- [ ] Event management
- [ ] Real-time messaging
- [ ] File uploads
- [ ] Search functionality
- [ ] Notifications
- [ ] Bookmarks
- [ ] Error handling
- [ ] Offline functionality
- [ ] Performance optimization

---

**🎯 Ready for seamless frontend-backend integration!**
