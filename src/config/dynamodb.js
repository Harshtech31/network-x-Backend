const AWS = require('aws-sdk');

// Configure AWS DynamoDB
const configureDynamoDB = () => {
  AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1'
  });

  return new AWS.DynamoDB.DocumentClient();
};

const dynamodb = configureDynamoDB();

// Table creation functions
const createTables = async () => {
  const dynamodbService = new AWS.DynamoDB();

  const tables = [
    {
      TableName: process.env.DYNAMODB_POSTS_TABLE || 'networkx-posts',
      KeySchema: [
        { AttributeName: 'postId', KeyType: 'HASH' }
      ],
      AttributeDefinitions: [
        { AttributeName: 'postId', AttributeType: 'S' },
        { AttributeName: 'userId', AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'UserPostsIndex',
          KeySchema: [
            { AttributeName: 'userId', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' }
          ],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
        }
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
    },
    {
      TableName: process.env.DYNAMODB_PROJECTS_TABLE || 'networkx-projects',
      KeySchema: [
        { AttributeName: 'projectId', KeyType: 'HASH' }
      ],
      AttributeDefinitions: [
        { AttributeName: 'projectId', AttributeType: 'S' },
        { AttributeName: 'creatorId', AttributeType: 'S' },
        { AttributeName: 'status', AttributeType: 'S' }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'CreatorProjectsIndex',
          KeySchema: [
            { AttributeName: 'creatorId', KeyType: 'HASH' }
          ],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
        },
        {
          IndexName: 'StatusIndex',
          KeySchema: [
            { AttributeName: 'status', KeyType: 'HASH' }
          ],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
        }
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
    },
    {
      TableName: process.env.DYNAMODB_CLUBS_TABLE || 'networkx-clubs',
      KeySchema: [
        { AttributeName: 'clubId', KeyType: 'HASH' }
      ],
      AttributeDefinitions: [
        { AttributeName: 'clubId', AttributeType: 'S' },
        { AttributeName: 'creatorId', AttributeType: 'S' },
        { AttributeName: 'category', AttributeType: 'S' }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'CreatorClubsIndex',
          KeySchema: [
            { AttributeName: 'creatorId', KeyType: 'HASH' }
          ],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
        },
        {
          IndexName: 'CategoryIndex',
          KeySchema: [
            { AttributeName: 'category', KeyType: 'HASH' }
          ],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
        }
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
    },
    {
      TableName: process.env.DYNAMODB_EVENTS_TABLE || 'networkx-events',
      KeySchema: [
        { AttributeName: 'eventId', KeyType: 'HASH' }
      ],
      AttributeDefinitions: [
        { AttributeName: 'eventId', AttributeType: 'S' },
        { AttributeName: 'creatorId', AttributeType: 'S' },
        { AttributeName: 'eventDate', AttributeType: 'S' }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'CreatorEventsIndex',
          KeySchema: [
            { AttributeName: 'creatorId', KeyType: 'HASH' }
          ],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
        },
        {
          IndexName: 'DateIndex',
          KeySchema: [
            { AttributeName: 'eventDate', KeyType: 'HASH' }
          ],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
        }
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
    }
  ];

  for (const table of tables) {
    try {
      await dynamodbService.createTable(table).promise();
      console.log(`✅ Created table: ${table.TableName}`);
    } catch (error) {
      if (error.code === 'ResourceInUseException') {
        console.log(`⚠️ Table already exists: ${table.TableName}`);
      } else {
        console.error(`❌ Error creating table ${table.TableName}:`, error.message);
      }
    }
  }
};

// Create Messages table
const createMessagesTable = async () => {
  const params = {
    TableName: process.env.DYNAMODB_MESSAGES_TABLE || 'networkx-messages',
    KeySchema: [
      { AttributeName: 'conversationId', KeyType: 'HASH' },
      { AttributeName: 'messageId', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'conversationId', AttributeType: 'S' },
      { AttributeName: 'messageId', AttributeType: 'S' },
      { AttributeName: 'senderId', AttributeType: 'S' },
      { AttributeName: 'timestamp', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'SenderMessagesIndex',
        KeySchema: [
          { AttributeName: 'senderId', KeyType: 'HASH' },
          { AttributeName: 'timestamp', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        BillingMode: 'PAY_PER_REQUEST'
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  };

  try {
    await dynamodb.createTable(params).promise();
    console.log('✅ Messages table created successfully');
  } catch (error) {
    if (error.code === 'ResourceInUseException') {
      console.log('ℹ️ Messages table already exists');
    } else {
      console.error('❌ Error creating Messages table:', error);
      throw error;
    }
  }
};

// Create Notifications table
const createNotificationsTable = async () => {
  const params = {
    TableName: process.env.DYNAMODB_NOTIFICATIONS_TABLE || 'networkx-notifications',
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' },
      { AttributeName: 'notificationId', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'notificationId', AttributeType: 'S' },
      { AttributeName: 'timestamp', AttributeType: 'S' },
      { AttributeName: 'type', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'TypeNotificationsIndex',
        KeySchema: [
          { AttributeName: 'type', KeyType: 'HASH' },
          { AttributeName: 'timestamp', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        BillingMode: 'PAY_PER_REQUEST'
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  };

  try {
    await dynamodb.createTable(params).promise();
    console.log('✅ Notifications table created successfully');
  } catch (error) {
    if (error.code === 'ResourceInUseException') {
      console.log('ℹ️ Notifications table already exists');
    } else {
      console.error('❌ Error creating Notifications table:', error);
      throw error;
    }
  }
};

// Create Collaborations table
const createCollaborationsTable = async () => {
  const params = {
    TableName: process.env.DYNAMODB_COLLABORATIONS_TABLE || 'networkx-collaborations',
    KeySchema: [
      { AttributeName: 'collaborationId', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'collaborationId', AttributeType: 'S' },
      { AttributeName: 'initiatorId', AttributeType: 'S' },
      { AttributeName: 'recipientId', AttributeType: 'S' },
      { AttributeName: 'status', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'InitiatorCollaborationsIndex',
        KeySchema: [
          { AttributeName: 'initiatorId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        BillingMode: 'PAY_PER_REQUEST'
      },
      {
        IndexName: 'RecipientCollaborationsIndex',
        KeySchema: [
          { AttributeName: 'recipientId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        BillingMode: 'PAY_PER_REQUEST'
      },
      {
        IndexName: 'StatusCollaborationsIndex',
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        BillingMode: 'PAY_PER_REQUEST'
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  };

  try {
    await dynamodb.createTable(params).promise();
    console.log('✅ Collaborations table created successfully');
  } catch (error) {
    if (error.code === 'ResourceInUseException') {
      console.log('ℹ️ Collaborations table already exists');
    } else {
      console.error('❌ Error creating Collaborations table:', error);
      throw error;
    }
  }
};

// Create all tables
const createAllTables = async () => {
  try {
    console.log('🔧 Creating DynamoDB tables...');
    
    await createPostsTable();
    await createProjectsTable();
    await createClubsTable();
    await createEventsTable();
    await createMessagesTable();
    await createNotificationsTable();
    await createCollaborationsTable();
    
    console.log('✅ All DynamoDB tables created successfully!');
  } catch (error) {
    console.error('❌ Error creating DynamoDB tables:', error);
  }
};

// Helper functions for common operations
const putItem = async (tableName, item) => {
  const params = {
    TableName: tableName,
    Item: {
      ...item,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };
  return await dynamodb.put(params).promise();
};

const getItem = async (tableName, key) => {
  const params = {
    TableName: tableName,
    Key: key
  };
  const result = await dynamodb.get(params).promise();
  return result.Item;
};

const updateItem = async (tableName, key, updateExpression, expressionAttributeValues, expressionAttributeNames = {}) => {
  const params = {
    TableName: tableName,
    Key: key,
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: {
      ...expressionAttributeValues,
      ':updatedAt': new Date().toISOString()
    },
    ExpressionAttributeNames: expressionAttributeNames,
    ReturnValues: 'ALL_NEW'
  };
  const result = await dynamodb.update(params).promise();
  return result.Attributes;
};

const deleteItem = async (tableName, key) => {
  const params = {
    TableName: tableName,
    Key: key
  };
  return await dynamodb.delete(params).promise();
};

const queryItems = async (tableName, keyConditionExpression, expressionAttributeValues, indexName = null, limit = null) => {
  const params = {
    TableName: tableName,
    KeyConditionExpression: keyConditionExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ScanIndexForward: false // Sort in descending order
  };
  
  if (indexName) params.IndexName = indexName;
  if (limit) params.Limit = limit;
  
  const result = await dynamodb.query(params).promise();
  return result.Items;
};

const scanItems = async (tableName, filterExpression = null, expressionAttributeValues = {}, limit = null) => {
  const params = {
    TableName: tableName
  };
  
  if (filterExpression) {
    params.FilterExpression = filterExpression;
    params.ExpressionAttributeValues = expressionAttributeValues;
  }
  if (limit) params.Limit = limit;
  
  const result = await dynamodb.scan(params).promise();
  return result.Items;
};

module.exports = {
  dynamodb,
  createTables,
  putItem,
  getItem,
  updateItem,
  deleteItem,
  queryItems,
  scanItems
};
