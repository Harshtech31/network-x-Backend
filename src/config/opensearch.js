const { Client } = require('@opensearch-project/opensearch');
const AWS = require('aws-sdk');

// Configure AWS credentials for OpenSearch
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

// Create OpenSearch client
const createOpenSearchClient = () => {
  const endpoint = process.env.OPENSEARCH_ENDPOINT;
  
  if (!endpoint) {
    console.warn('OpenSearch endpoint not configured. Search functionality will be limited.');
    return null;
  }

  const client = new Client({
    node: endpoint,
    auth: {
      username: process.env.OPENSEARCH_USERNAME || 'admin',
      password: process.env.OPENSEARCH_PASSWORD || 'admin'
    },
    ssl: {
      rejectUnauthorized: false // For development only
    }
  });

  return client;
};

const client = createOpenSearchClient();

// Index mappings for different content types
const INDEX_MAPPINGS = {
  users: {
    mappings: {
      properties: {
        userId: { type: 'keyword' },
        firstName: { type: 'text', analyzer: 'standard' },
        lastName: { type: 'text', analyzer: 'standard' },
        username: { type: 'keyword' },
        email: { type: 'keyword' },
        department: { type: 'keyword' },
        year: { type: 'integer' },
        skills: { type: 'text', analyzer: 'standard' },
        interests: { type: 'text', analyzer: 'standard' },
        bio: { type: 'text', analyzer: 'standard' },
        location: { type: 'text' },
        rating: { type: 'float' },
        isVerified: { type: 'boolean' },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' }
      }
    }
  },
  posts: {
    mappings: {
      properties: {
        postId: { type: 'keyword' },
        authorId: { type: 'keyword' },
        title: { type: 'text', analyzer: 'standard' },
        content: { type: 'text', analyzer: 'standard' },
        tags: { type: 'keyword' },
        category: { type: 'keyword' },
        likes: { type: 'integer' },
        comments: { type: 'integer' },
        shares: { type: 'integer' },
        isPublic: { type: 'boolean' },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' }
      }
    }
  },
  projects: {
    mappings: {
      properties: {
        projectId: { type: 'keyword' },
        createdBy: { type: 'keyword' },
        title: { type: 'text', analyzer: 'standard' },
        description: { type: 'text', analyzer: 'standard' },
        skills: { type: 'keyword' },
        technologies: { type: 'keyword' },
        category: { type: 'keyword' },
        status: { type: 'keyword' },
        difficulty: { type: 'keyword' },
        duration: { type: 'keyword' },
        teamSize: { type: 'integer' },
        isOpen: { type: 'boolean' },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' }
      }
    }
  },
  clubs: {
    mappings: {
      properties: {
        clubId: { type: 'keyword' },
        createdBy: { type: 'keyword' },
        name: { type: 'text', analyzer: 'standard' },
        description: { type: 'text', analyzer: 'standard' },
        category: { type: 'keyword' },
        tags: { type: 'keyword' },
        memberCount: { type: 'integer' },
        isPublic: { type: 'boolean' },
        isActive: { type: 'boolean' },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' }
      }
    }
  },
  events: {
    mappings: {
      properties: {
        eventId: { type: 'keyword' },
        createdBy: { type: 'keyword' },
        clubId: { type: 'keyword' },
        title: { type: 'text', analyzer: 'standard' },
        description: { type: 'text', analyzer: 'standard' },
        category: { type: 'keyword' },
        tags: { type: 'keyword' },
        location: { type: 'text' },
        startDate: { type: 'date' },
        endDate: { type: 'date' },
        maxAttendees: { type: 'integer' },
        currentAttendees: { type: 'integer' },
        isPublic: { type: 'boolean' },
        status: { type: 'keyword' },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' }
      }
    }
  }
};

// Initialize OpenSearch indices
const initializeIndices = async () => {
  if (!client) {
    console.log('OpenSearch client not available. Skipping index initialization.');
    return;
  }

  try {
    for (const [indexName, mapping] of Object.entries(INDEX_MAPPINGS)) {
      const indexExists = await client.indices.exists({ index: indexName });
      
      if (!indexExists.body) {
        await client.indices.create({
          index: indexName,
          body: mapping
        });
        console.log(`✅ Created OpenSearch index: ${indexName}`);
      } else {
        console.log(`📋 OpenSearch index already exists: ${indexName}`);
      }
    }
  } catch (error) {
    console.error('❌ Error initializing OpenSearch indices:', error);
  }
};

// Index document in OpenSearch
const indexDocument = async (index, id, document) => {
  if (!client) {
    console.warn('OpenSearch client not available. Document not indexed.');
    return null;
  }

  try {
    const response = await client.index({
      index,
      id,
      body: document,
      refresh: true
    });
    return response.body;
  } catch (error) {
    console.error(`Error indexing document in ${index}:`, error);
    return null;
  }
};

// Update document in OpenSearch
const updateDocument = async (index, id, document) => {
  if (!client) {
    console.warn('OpenSearch client not available. Document not updated.');
    return null;
  }

  try {
    const response = await client.update({
      index,
      id,
      body: {
        doc: document,
        doc_as_upsert: true
      },
      refresh: true
    });
    return response.body;
  } catch (error) {
    console.error(`Error updating document in ${index}:`, error);
    return null;
  }
};

// Delete document from OpenSearch
const deleteDocument = async (index, id) => {
  if (!client) {
    console.warn('OpenSearch client not available. Document not deleted.');
    return null;
  }

  try {
    const response = await client.delete({
      index,
      id,
      refresh: true
    });
    return response.body;
  } catch (error) {
    console.error(`Error deleting document from ${index}:`, error);
    return null;
  }
};

// Advanced search function
const searchDocuments = async (indices, query, filters = {}, options = {}) => {
  if (!client) {
    console.warn('OpenSearch client not available. Returning empty results.');
    return { hits: { hits: [], total: { value: 0 } } };
  }

  try {
    const {
      from = 0,
      size = 20,
      sort = [{ _score: { order: 'desc' } }],
      highlight = {}
    } = options;

    // Build search query
    const searchBody = {
      from,
      size,
      sort,
      query: {
        bool: {
          must: [],
          filter: []
        }
      }
    };

    // Add text search
    if (query && query.trim()) {
      searchBody.query.bool.must.push({
        multi_match: {
          query: query.trim(),
          fields: ['title^3', 'name^3', 'firstName^2', 'lastName^2', 'content', 'description', 'skills', 'interests', 'bio'],
          type: 'best_fields',
          fuzziness: 'AUTO'
        }
      });
    } else {
      searchBody.query.bool.must.push({ match_all: {} });
    }

    // Add filters
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        if (Array.isArray(value)) {
          searchBody.query.bool.filter.push({
            terms: { [key]: value }
          });
        } else {
          searchBody.query.bool.filter.push({
            term: { [key]: value }
          });
        }
      }
    });

    // Add highlighting
    if (Object.keys(highlight).length > 0) {
      searchBody.highlight = {
        fields: highlight,
        pre_tags: ['<mark>'],
        post_tags: ['</mark>']
      };
    }

    const response = await client.search({
      index: indices.join(','),
      body: searchBody
    });

    return response.body;
  } catch (error) {
    console.error('Error searching documents:', error);
    return { hits: { hits: [], total: { value: 0 } } };
  }
};

// Get search suggestions
const getSearchSuggestions = async (query, index = 'users,posts,projects,clubs,events') => {
  if (!client || !query || query.length < 2) {
    return [];
  }

  try {
    const response = await client.search({
      index,
      body: {
        size: 0,
        suggest: {
          suggestions: {
            text: query,
            completion: {
              field: 'suggest',
              size: 10,
              skip_duplicates: true
            }
          }
        }
      }
    });

    return response.body.suggest?.suggestions?.[0]?.options || [];
  } catch (error) {
    console.error('Error getting search suggestions:', error);
    return [];
  }
};

// Bulk index documents
const bulkIndex = async (operations) => {
  if (!client) {
    console.warn('OpenSearch client not available. Bulk operation skipped.');
    return null;
  }

  try {
    const response = await client.bulk({
      body: operations,
      refresh: true
    });
    return response.body;
  } catch (error) {
    console.error('Error in bulk indexing:', error);
    return null;
  }
};

module.exports = {
  client,
  initializeIndices,
  indexDocument,
  updateDocument,
  deleteDocument,
  searchDocuments,
  getSearchSuggestions,
  bulkIndex,
  INDEX_MAPPINGS
};
