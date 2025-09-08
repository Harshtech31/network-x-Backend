module.exports = (sequelize, DataTypes) => {
  const ProjectMember = sequelize.define('ProjectMember', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    role: {
      type: DataTypes.ENUM('owner', 'admin', 'member', 'contributor'),
      defaultValue: 'contributor'
    },
    joinDate: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    status: {
      type: DataTypes.ENUM('active', 'pending', 'inactive'),
      defaultValue: 'pending'
    },
    skills: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    responsibilities: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    contribution: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0,
        max: 100
      }
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    projectId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'projects',
        key: 'id'
      }
    }
  }, {
    tableName: 'project_members',
    indexes: [
      {
        unique: true,
        fields: ['userId', 'projectId']
      },
      {
        fields: ['role']
      },
      {
        fields: ['status']
      }
    ]
  });

  return ProjectMember;
};
