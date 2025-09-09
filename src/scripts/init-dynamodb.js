const AWS = require('aws-sdk');
require('dotenv').config();

// Configure AWS
AWS.config.update({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const dynamodb = new AWS.DynamoDB();

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
    BillingMode: 'PROVISIONED',
    ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 }
  },
  {
    TableName: process.env.DYNAMODB_PROJECTS_TABLE || 'networkx-projects',
    KeySchema: [
      { AttributeName: 'projectId', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'projectId', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'status', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'UserProjectsIndex',
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      },
      {
        IndexName: 'StatusIndex',
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      }
    ],
    BillingMode: 'PROVISIONED',
    ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 }
  },
  {
    TableName: process.env.DYNAMODB_CLUBS_TABLE || 'networkx-clubs',
    KeySchema: [
      { AttributeName: 'clubId', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'clubId', AttributeType: 'S' },
      { AttributeName: 'createdBy', AttributeType: 'S' },
      { AttributeName: 'category', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'CreatorIndex',
        KeySchema: [
          { AttributeName: 'createdBy', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      },
      {
        IndexName: 'CategoryIndex',
        KeySchema: [
          { AttributeName: 'category', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      }
    ],
    BillingMode: 'PROVISIONED',
    ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 }
  },
  {
    TableName: process.env.DYNAMODB_EVENTS_TABLE || 'networkx-events',
    KeySchema: [
      { AttributeName: 'eventId', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'eventId', AttributeType: 'S' },
      { AttributeName: 'organizerId', AttributeType: 'S' },
      { AttributeName: 'eventDate', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'OrganizerIndex',
        KeySchema: [
          { AttributeName: 'organizerId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
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
    BillingMode: 'PROVISIONED',
    ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 }
  },
  {
    TableName: process.env.DYNAMODB_MESSAGES_TABLE || 'networkx-messages',
    KeySchema: [
      { AttributeName: 'messageId', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'messageId', AttributeType: 'S' },
      { AttributeName: 'conversationId', AttributeType: 'S' },
      { AttributeName: 'senderId', AttributeType: 'S' },
      { AttributeName: 'timestamp', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'ConversationIndex',
        KeySchema: [
          { AttributeName: 'conversationId', KeyType: 'HASH' },
          { AttributeName: 'timestamp', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 }
      },
      {
        IndexName: 'SenderIndex',
        KeySchema: [
          { AttributeName: 'senderId', KeyType: 'HASH' },
          { AttributeName: 'timestamp', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      }
    ],
    BillingMode: 'PROVISIONED',
    ProvisionedThroughput: { ReadCapacityUnits: 15, WriteCapacityUnits: 15 }
  },
  {
    TableName: process.env.DYNAMODB_NOTIFICATIONS_TABLE || 'networkx-notifications',
    KeySchema: [
      { AttributeName: 'notificationId', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'notificationId', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'UserNotificationsIndex',
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 }
      }
    ],
    BillingMode: 'PROVISIONED',
    ProvisionedThroughput: { ReadCapacityUnits: 15, WriteCapacityUnits: 15 }
  },
  {
    TableName: process.env.DYNAMODB_COLLABORATIONS_TABLE || 'networkx-collaborations',
    KeySchema: [
      { AttributeName: 'collaborationId', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'collaborationId', AttributeType: 'S' },
      { AttributeName: 'initiatorId', AttributeType: 'S' },
      { AttributeName: 'partnerId', AttributeType: 'S' },
      { AttributeName: 'status', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'InitiatorIndex',
        KeySchema: [
          { AttributeName: 'initiatorId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      },
      {
        IndexName: 'PartnerIndex',
        KeySchema: [
          { AttributeName: 'partnerId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      },
      {
        IndexName: 'StatusIndex',
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      }
    ],
    BillingMode: 'PROVISIONED',
    ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 }
  },
  {
    TableName: process.env.DYNAMODB_REPORTS_TABLE || 'networkx-reports',
    KeySchema: [
      { AttributeName: 'reportId', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'reportId', AttributeType: 'S' },
      { AttributeName: 'reporterId', AttributeType: 'S' },
      { AttributeName: 'status', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'ReporterIndex',
        KeySchema: [
          { AttributeName: 'reporterId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      },
      {
        IndexName: 'StatusIndex',
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      }
    ],
    BillingMode: 'PROVISIONED',
    ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 }
  },
  {
    TableName: process.env.DYNAMODB_BOOKMARKS_TABLE || 'networkx-bookmarks',
    KeySchema: [
      { AttributeName: 'bookmarkId', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'bookmarkId', AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'contentType', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'UserBookmarksIndex',
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      },
      {
        IndexName: 'ContentTypeIndex',
        KeySchema: [
          { AttributeName: 'contentType', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
      }
    ],
    BillingMode: 'PROVISIONED',
    ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 }
  }
];

async function createTable(tableConfig) {
  try {
    console.log(`Creating table: ${tableConfig.TableName}...`);
    
    // Check if table already exists
    try {
      await dynamodb.describeTable({ TableName: tableConfig.TableName }).promise();
      console.log(`✅ Table ${tableConfig.TableName} already exists`);
      return;
    } catch (error) {
      if (error.code !== 'ResourceNotFoundException') {
        throw error;
      }
    }

    // Create the table
    const result = await dynamodb.createTable(tableConfig).promise();
    console.log(`✅ Table ${tableConfig.TableName} created successfully`);
    
    // Wait for table to become active
    console.log(`⏳ Waiting for table ${tableConfig.TableName} to become active...`);
    await dynamodb.waitFor('tableExists', { TableName: tableConfig.TableName }).promise();
    console.log(`✅ Table ${tableConfig.TableName} is now active`);
    
  } catch (error) {
    console.error(`❌ Error creating table ${tableConfig.TableName}:`, error.message);
    throw error;
  }
}

async function initializeDynamoDB() {
  console.log('🚀 Starting DynamoDB table initialization...\n');
  
  try {
    // Verify AWS credentials
    const sts = new AWS.STS();
    await sts.getCallerIdentity().promise();
    console.log('✅ AWS credentials verified\n');
    
    // Create all tables
    for (const tableConfig of tables) {
      await createTable(tableConfig);
      console.log(''); // Add spacing between tables
    }
    
    console.log('🎉 All DynamoDB tables initialized successfully!');
    console.log('\nCreated tables:');
    tables.forEach(table => {
      console.log(`  - ${table.TableName}`);
    });
    
  } catch (error) {
    console.error('❌ Failed to initialize DynamoDB tables:', error.message);
    process.exit(1);
  }
}

async function deleteTables() {
  console.log('🗑️  Starting DynamoDB table deletion...\n');
  
  try {
    for (const tableConfig of tables) {
      try {
        console.log(`Deleting table: ${tableConfig.TableName}...`);
        await dynamodb.deleteTable({ TableName: tableConfig.TableName }).promise();
        console.log(`✅ Table ${tableConfig.TableName} deleted successfully`);
      } catch (error) {
        if (error.code === 'ResourceNotFoundException') {
          console.log(`⚠️  Table ${tableConfig.TableName} does not exist`);
        } else {
          throw error;
        }
      }
    }
    
    console.log('\n🎉 All DynamoDB tables deleted successfully!');
    
  } catch (error) {
    console.error('❌ Failed to delete DynamoDB tables:', error.message);
    process.exit(1);
  }
}

// CLI interface
const command = process.argv[2];

if (command === 'create') {
  initializeDynamoDB();
} else if (command === 'delete') {
  deleteTables();
} else {
  console.log('Usage:');
  console.log('  node init-dynamodb.js create  - Create all tables');
  console.log('  node init-dynamodb.js delete  - Delete all tables');
  process.exit(1);
}

module.exports = { initializeDynamoDB, deleteTables };
