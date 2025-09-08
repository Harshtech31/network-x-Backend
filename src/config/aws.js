const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const s3 = new AWS.S3();

// File filter function
const fileFilter = (req, file, cb) => {
  // Check file type
  const allowedTypes = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/mpeg': 'mpeg',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi'
  };

  if (allowedTypes[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images and videos are allowed.'), false);
  }
};

// Generate unique filename
const generateFileName = (originalname) => {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const extension = path.extname(originalname);
  return `${timestamp}-${randomString}${extension}`;
};

// S3 upload configuration
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_S3_BUCKET_NAME,
    acl: 'public-read',
    key: function (req, file, cb) {
      const folder = file.mimetype.startsWith('image/') ? 'images' : 'videos';
      const fileName = generateFileName(file.originalname);
      cb(null, `networkx/${folder}/${fileName}`);
    },
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: function (req, file, cb) {
      cb(null, {
        fieldName: file.fieldname,
        uploadedBy: req.user ? req.user.id : 'anonymous',
        uploadDate: new Date().toISOString()
      });
    }
  }),
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 5 // Maximum 5 files per upload
  }
});

// Delete file from S3
const deleteFile = async (fileUrl) => {
  try {
    // Extract key from URL
    const urlParts = fileUrl.split('/');
    const key = urlParts.slice(-3).join('/'); // Get last 3 parts: networkx/folder/filename
    
    const params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key
    };
    
    await s3.deleteObject(params).promise();
    return true;
  } catch (error) {
    console.error('Error deleting file from S3:', error);
    return false;
  }
};

// Get signed URL for private files
const getSignedUrl = (key, expires = 3600) => {
  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    Expires: expires
  };
  
  return s3.getSignedUrl('getObject', params);
};

// Upload middleware configurations
const uploadMiddleware = {
  // Single file upload
  single: (fieldName) => upload.single(fieldName),
  
  // Multiple files upload
  array: (fieldName, maxCount = 5) => upload.array(fieldName, maxCount),
  
  // Multiple fields upload
  fields: (fields) => upload.fields(fields),
  
  // Profile image upload
  profileImage: upload.single('profileImage'),
  
  // Post media upload (images and videos)
  postMedia: upload.array('media', 5),
  
  // Project files upload
  projectFiles: upload.array('files', 10)
};

module.exports = {
  s3,
  upload,
  uploadMiddleware,
  deleteFile,
  getSignedUrl
};
