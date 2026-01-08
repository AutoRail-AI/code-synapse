/**
 * Documentation Graph Models
 *
 * Models for linking infrastructure code to official documentation,
 * SDK references, and version-specific resources.
 */

// =============================================================================
// Documentation Reference Types
// =============================================================================

/**
 * Type of documentation resource
 */
export type DocumentationType =
  | "official-docs" // Official documentation (e.g., docs.redis.io)
  | "api-reference" // API/SDK reference docs
  | "tutorial" // Getting started / tutorials
  | "changelog" // Version changelog
  | "migration-guide" // Migration between versions
  | "mcp-server" // MCP server documentation
  | "internal-runbook" // Internal runbooks/wikis
  | "github-repo" // Source repository
  | "npm-package" // NPM package page
  | "pypi-package"; // PyPI package page

/**
 * Documentation source/provider
 */
export type DocumentationSource =
  | "npm"
  | "pypi"
  | "github"
  | "official"
  | "mcp-registry"
  | "internal"
  | "inferred";

// =============================================================================
// Documentation Reference
// =============================================================================

/**
 * A reference to external documentation for a dependency/library
 */
export interface DocumentationReference {
  /** Unique identifier */
  id: string;

  /** Name of the library/dependency (e.g., "redis", "@prisma/client") */
  packageName: string;

  /** Version or version range this doc applies to */
  version?: string;

  /** Type of documentation */
  type: DocumentationType;

  /** URL to the documentation */
  url: string;

  /** Human-readable title */
  title: string;

  /** Brief description of what this doc covers */
  description?: string;

  /** Source where this reference was found/inferred */
  source: DocumentationSource;

  /** Confidence in the accuracy of this reference (0-1) */
  confidence: number;

  /** When this reference was last verified */
  lastVerifiedAt?: string;

  /** When this reference was created */
  createdAt: string;

  /** Tags for categorization */
  tags?: string[];
}

// =============================================================================
// Entity-Documentation Link
// =============================================================================

/**
 * Links a code entity to documentation
 */
export interface EntityDocumentationLink {
  /** Unique identifier */
  id: string;

  /** The code entity ID (function, class, file, etc.) */
  entityId: string;

  /** Type of entity */
  entityType: "file" | "function" | "class" | "interface" | "variable";

  /** The documentation reference ID */
  documentationId: string;

  /** Relevance score (0-1) - how relevant is this doc to this entity */
  relevance: number;

  /** Why this link was created */
  linkReason:
    | "import-detected" // Entity imports this package
    | "type-usage" // Entity uses types from this package
    | "api-call" // Entity calls APIs from this package
    | "manual" // Manually linked by user
    | "inferred"; // Inferred by pattern matching

  /** When this link was created */
  createdAt: string;
}

// =============================================================================
// Horizontal (Infrastructure) Classification
// =============================================================================

/**
 * Known horizontal/infrastructure categories with documentation patterns
 */
export interface HorizontalCategory {
  /** Category identifier */
  id: string;

  /** Display name */
  name: string;

  /** Description */
  description: string;

  /** Package name patterns that match this category */
  packagePatterns: string[];

  /** Import patterns that suggest this category */
  importPatterns: string[];

  /** Known documentation URLs for this category */
  knownDocs: Array<{
    packageName: string;
    urls: Array<{
      type: DocumentationType;
      url: string;
      title: string;
    }>;
  }>;
}

// =============================================================================
// Documentation Query Results
// =============================================================================

/**
 * Result of querying documentation for an entity
 */
export interface EntityDocumentation {
  /** The entity ID */
  entityId: string;

  /** Entity name */
  entityName: string;

  /** Entity type */
  entityType: string;

  /** File path where entity is defined */
  filePath: string;

  /** Detected dependencies for this entity */
  dependencies: Array<{
    packageName: string;
    version?: string;
    usageType: "import" | "type" | "api-call";
  }>;

  /** Linked documentation references */
  documentation: Array<
    DocumentationReference & {
      relevance: number;
      linkReason: EntityDocumentationLink["linkReason"];
    }
  >;
}

/**
 * Statistics about documentation coverage
 */
export interface DocumentationStats {
  /** Total documentation references */
  totalReferences: number;

  /** References by type */
  byType: Record<DocumentationType, number>;

  /** References by source */
  bySource: Record<DocumentationSource, number>;

  /** Total entity-documentation links */
  totalLinks: number;

  /** Entities with documentation */
  entitiesWithDocs: number;

  /** Entities without documentation */
  entitiesWithoutDocs: number;

  /** Coverage percentage */
  coveragePercent: number;

  /** Most documented packages */
  topPackages: Array<{
    packageName: string;
    referenceCount: number;
    linkCount: number;
  }>;
}

// =============================================================================
// Known Documentation Registry
// =============================================================================

/**
 * Pre-defined documentation URLs for common packages
 */
export const KNOWN_DOCUMENTATION: Record<
  string,
  Array<{
    type: DocumentationType;
    url: string;
    title: string;
  }>
> = {
  // Database clients
  prisma: [
    {
      type: "official-docs",
      url: "https://www.prisma.io/docs",
      title: "Prisma Documentation",
    },
    {
      type: "api-reference",
      url: "https://www.prisma.io/docs/reference/api-reference",
      title: "Prisma API Reference",
    },
  ],
  "@prisma/client": [
    {
      type: "official-docs",
      url: "https://www.prisma.io/docs/concepts/components/prisma-client",
      title: "Prisma Client Docs",
    },
  ],
  mongoose: [
    {
      type: "official-docs",
      url: "https://mongoosejs.com/docs/",
      title: "Mongoose Documentation",
    },
    {
      type: "api-reference",
      url: "https://mongoosejs.com/docs/api.html",
      title: "Mongoose API Reference",
    },
  ],
  pg: [
    {
      type: "official-docs",
      url: "https://node-postgres.com/",
      title: "node-postgres Documentation",
    },
  ],
  mysql2: [
    {
      type: "github-repo",
      url: "https://github.com/sidorares/node-mysql2",
      title: "mysql2 GitHub",
    },
  ],

  // Cache
  redis: [
    {
      type: "official-docs",
      url: "https://redis.io/docs/",
      title: "Redis Documentation",
    },
    {
      type: "api-reference",
      url: "https://redis.io/commands/",
      title: "Redis Commands Reference",
    },
  ],
  ioredis: [
    {
      type: "github-repo",
      url: "https://github.com/redis/ioredis",
      title: "ioredis GitHub",
    },
    {
      type: "api-reference",
      url: "https://redis.github.io/ioredis/",
      title: "ioredis API Docs",
    },
  ],

  // Message queues
  amqplib: [
    {
      type: "official-docs",
      url: "https://www.rabbitmq.com/tutorials",
      title: "RabbitMQ Tutorials",
    },
    {
      type: "api-reference",
      url: "https://amqp-node.github.io/amqplib/",
      title: "amqplib API Reference",
    },
  ],
  kafkajs: [
    {
      type: "official-docs",
      url: "https://kafka.js.org/docs/getting-started",
      title: "KafkaJS Documentation",
    },
  ],
  bullmq: [
    {
      type: "official-docs",
      url: "https://docs.bullmq.io/",
      title: "BullMQ Documentation",
    },
  ],

  // HTTP clients
  axios: [
    {
      type: "official-docs",
      url: "https://axios-http.com/docs/intro",
      title: "Axios Documentation",
    },
  ],
  "node-fetch": [
    {
      type: "github-repo",
      url: "https://github.com/node-fetch/node-fetch",
      title: "node-fetch GitHub",
    },
  ],

  // Cloud SDKs
  "@aws-sdk/client-s3": [
    {
      type: "official-docs",
      url: "https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/",
      title: "AWS S3 SDK v3 Docs",
    },
  ],
  "@google-cloud/storage": [
    {
      type: "official-docs",
      url: "https://cloud.google.com/storage/docs/reference/libraries",
      title: "Google Cloud Storage Client",
    },
  ],
  "@azure/storage-blob": [
    {
      type: "official-docs",
      url: "https://learn.microsoft.com/en-us/javascript/api/@azure/storage-blob/",
      title: "Azure Blob Storage SDK",
    },
  ],

  // Authentication
  passport: [
    {
      type: "official-docs",
      url: "https://www.passportjs.org/docs/",
      title: "Passport.js Documentation",
    },
  ],
  jsonwebtoken: [
    {
      type: "github-repo",
      url: "https://github.com/auth0/node-jsonwebtoken",
      title: "jsonwebtoken GitHub",
    },
  ],

  // Payment
  stripe: [
    {
      type: "official-docs",
      url: "https://stripe.com/docs",
      title: "Stripe Documentation",
    },
    {
      type: "api-reference",
      url: "https://stripe.com/docs/api",
      title: "Stripe API Reference",
    },
  ],

  // Logging/Monitoring
  pino: [
    {
      type: "official-docs",
      url: "https://getpino.io/",
      title: "Pino Documentation",
    },
  ],
  winston: [
    {
      type: "github-repo",
      url: "https://github.com/winstonjs/winston",
      title: "Winston GitHub",
    },
  ],

  // Testing
  vitest: [
    {
      type: "official-docs",
      url: "https://vitest.dev/",
      title: "Vitest Documentation",
    },
  ],
  jest: [
    {
      type: "official-docs",
      url: "https://jestjs.io/docs/getting-started",
      title: "Jest Documentation",
    },
  ],

  // Web frameworks
  express: [
    {
      type: "official-docs",
      url: "https://expressjs.com/",
      title: "Express.js Documentation",
    },
    {
      type: "api-reference",
      url: "https://expressjs.com/en/4x/api.html",
      title: "Express API Reference",
    },
  ],
  fastify: [
    {
      type: "official-docs",
      url: "https://fastify.dev/docs/latest/",
      title: "Fastify Documentation",
    },
  ],
  "@nestjs/core": [
    {
      type: "official-docs",
      url: "https://docs.nestjs.com/",
      title: "NestJS Documentation",
    },
  ],

  // Validation
  zod: [
    {
      type: "official-docs",
      url: "https://zod.dev/",
      title: "Zod Documentation",
    },
  ],
  joi: [
    {
      type: "official-docs",
      url: "https://joi.dev/api/",
      title: "Joi API Documentation",
    },
  ],

  // ORM/Query builders
  typeorm: [
    {
      type: "official-docs",
      url: "https://typeorm.io/",
      title: "TypeORM Documentation",
    },
  ],
  sequelize: [
    {
      type: "official-docs",
      url: "https://sequelize.org/docs/v6/",
      title: "Sequelize Documentation",
    },
  ],
  knex: [
    {
      type: "official-docs",
      url: "https://knexjs.org/guide/",
      title: "Knex.js Documentation",
    },
  ],

  // GraphQL
  graphql: [
    {
      type: "official-docs",
      url: "https://graphql.org/learn/",
      title: "GraphQL Documentation",
    },
  ],
  "@apollo/server": [
    {
      type: "official-docs",
      url: "https://www.apollographql.com/docs/apollo-server/",
      title: "Apollo Server Documentation",
    },
  ],
};
