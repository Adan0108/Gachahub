import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  GameMemberRole,
  GameStatus,
  MediaPurpose,
  MediaResourceType,
  MediaUploadStatus,
  PostMediaType,
  PostStatus,
  PostType,
  PostVisibility,
  PrismaClient,
  UserRole,
  UserStatus,
} from '../src/generated/prisma/client';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing from .env');
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
});

const prisma = new PrismaClient({
  adapter,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Existing development users.
 *
 * These users are NOT created or deleted by this seed.
 * They are only reused as authors/followers when they already exist.
 */
const EXISTING_USER_IDS = [
  '5Hq7wkYuaBdwfbVE8LplPx6ZcQq7zc68',
  'JowB3PKnM1Fejjgvd07hHZWku8dM6pnr',
  'UqGpaeSgbdaKRNogbmUuuDthnMXIIiya',
  'fd2HOAA7NwVOrdcIyfgljrT5SH6Lo9az',
  'ksaIxdxyJum8IRLOhig5NXHW9dz8IEz7',
  'ygHEuZG4yy3AmVvwHOFei4qBf9BMqASO',
] as const;

/**
 * Main account used for testing Feed social boost.
 */
const MAIN_TEST_USER_ID = 'JowB3PKnM1Fejjgvd07hHZWku8dM6pnr';

interface GameSeedDefinition {
  name: string;
  slug: string;
  description: string;
  developer: string;
  publisher: string;
}

interface SeedGame {
  id: string;
  name: string;
  slug: string;
}

interface SeedUser {
  id: string;
  name: string;
}

interface SeededPost {
  id: string;
  authorId: string;
  gameId: string;
  type: PostType;

  commentTarget: number;
  likeTarget: number;
}

interface SeedComment {
  id: string;
}

const GAMES: GameSeedDefinition[] = [
  {
    name: 'Wuthering Waves',
    slug: 'wuthering-waves',
    description:
      'Community for Wuthering Waves players, builds, guides, lore and discussions.',
    developer: 'Kuro Games',
    publisher: 'Kuro Games',
  },
  {
    name: 'Honkai: Star Rail',
    slug: 'honkai-star-rail',
    description:
      'Community for Honkai: Star Rail players, teams, builds and lore.',
    developer: 'HoYoverse',
    publisher: 'HoYoverse',
  },
  {
    name: 'Genshin Impact',
    slug: 'genshin-impact',
    description:
      'Community for Genshin Impact players, exploration, builds and lore.',
    developer: 'HoYoverse',
    publisher: 'HoYoverse',
  },
  {
    name: 'GODDESS OF VICTORY: NIKKE',
    slug: 'nikke',
    description:
      'Community for NIKKE commanders, team building, guides and story discussion.',
    developer: 'SHIFT UP',
    publisher: 'Level Infinite',
  },
  {
    name: 'Arknights: Endfield',
    slug: 'arknights-endfield',
    description:
      'Community for Arknights: Endfield strategies, operators, teams and lore.',
    developer: 'Hypergryph',
    publisher: 'GRYPHLINE',
  },
  {
    name: 'Neverness to Everness',
    slug: 'neverness-to-everness',
    description:
      'Community for Neverness to Everness news, characters and discussion.',
    developer: 'Hotta Studio',
    publisher: 'Perfect World Games',
  },
];

const CATEGORIES = [
  {
    name: 'General',
    slug: 'general',
    description: 'General community discussion',
    icon: 'message-circle',
  },
  {
    name: 'Guides',
    slug: 'guide',
    description: 'Guides and tutorials for players',
    icon: 'book',
  },
  {
    name: 'Builds',
    slug: 'build',
    description: 'Character and equipment builds',
    icon: 'hammer',
  },
  {
    name: 'Teams',
    slug: 'team',
    description: 'Team compositions and strategy',
    icon: 'users',
  },
  {
    name: 'Lore',
    slug: 'lore',
    description: 'Story and lore discussion',
    icon: 'book-open',
  },
  {
    name: 'Theory',
    slug: 'theory',
    description: 'Theories and speculation',
    icon: 'brain',
  },
  {
    name: 'Questions',
    slug: 'question',
    description: 'Questions and community help',
    icon: 'help-circle',
  },
  {
    name: 'News',
    slug: 'news',
    description: 'Game news and announcements',
    icon: 'newspaper',
  },
  {
    name: 'Memes',
    slug: 'meme',
    description: 'Memes and community humour',
    icon: 'smile',
  },
] as const;

const TAGS = [
  'Beginner',
  'Endgame',
  'F2P',
  'DPS',
  'Support',
  'Healer',
  'Build',
  'Team',
  'Guide',
  'Lore',
  'Theory',
  'Story',
  'Exploration',
  'Boss',
  'Meta',
  'Patch',
  'Character',
  'Weapon',
  'Meme',
  'Discussion',
] as const;

const USER_NAMES = [
  'LunaBuilds',
  'EchoTheory',
  'MarchEnjoyer',
  'GachaProfessor',
  'RoverMain',
  'TrailblazerDaily',
  'TeyvatChef',
  'CommanderRapi',
  'EndfieldEngineer',
  'NTEWatcher',
  'CasualPuller',
  'MetaCalculator',
  'LoreArchive',
  'F2PJourney',
  'CritRateEnjoyer',
  'WaifuCollector',
  'HusbandoCollector',
  'WeeklyBoss',
  'PityLostAgain',
  'OneMorePull',
  'TheoryCrafter',
  'GuideMaker',
  'StoryReader',
  'BuildTester',
  'TeamPlanner',
  'PatchWatcher',
  'MemeDealer',
  'ExplorationMain',
  'DailyGrinder',
  'GachaNews',
] as const;

const POST_TEMPLATES = [
  {
    type: PostType.GENERAL,
    category: 'general',
    title: 'What are you working on this week?',
    content:
      'Curious what everyone is currently farming or preparing for. Share your current goals and what you are saving resources for.',
  },
  {
    type: PostType.GUIDE,
    category: 'guide',
    title: 'Beginner progression guide and common mistakes',
    content:
      'A practical progression guide covering resource priorities, early upgrades and several common mistakes that can slow down a new account.',
  },
  {
    type: PostType.BUILD,
    category: 'build',
    title: 'My current endgame DPS build',
    content:
      'I have been testing this setup in endgame content. Here are the main stats, equipment choices and alternatives for players with fewer resources.',
  },
  {
    type: PostType.TEAM,
    category: 'team',
    title: 'Team composition ideas for difficult content',
    content:
      'Here are several team combinations I have been experimenting with, including a more accessible F2P alternative.',
  },
  {
    type: PostType.LORE,
    category: 'lore',
    title: 'Small lore detail I almost missed',
    content:
      'There is a small environmental and dialogue detail that may connect two parts of the story. I wanted to see what other lore readers think.',
  },
  {
    type: PostType.THEORY,
    category: 'theory',
    title: 'Theory about the next story direction',
    content:
      'This is speculation rather than confirmed information, but several recent story details appear to point in the same direction.',
  },
  {
    type: PostType.QUESTION,
    category: 'question',
    title: 'Which upgrade should I prioritise?',
    content:
      'I have limited materials and can only invest into one option this week. Which choice gives the best improvement for this account?',
  },
  {
    type: PostType.NEWS,
    category: 'news',
    title: 'Thoughts on the latest game update?',
    content:
      'The latest update introduced several interesting changes. What features or balance changes stood out to everyone?',
  },
  {
    type: PostType.MEME,
    category: 'meme',
    title: 'Me after saying I would save my pulls',
    content:
      'I lasted considerably less time than expected. Surely the next banner will be the one where I finally demonstrate self-control.',
  },
] as const;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Deterministic pseudo-random number.
 *
 * Deterministic seed data makes feed bugs reproducible.
 */
function seededNumber(seed: number): number {
  const x = Math.sin(seed * 9999.1337) * 10000;

  return x - Math.floor(x);
}

function seededInt(seed: number, min: number, max: number): number {
  return Math.floor(seededNumber(seed) * (max - min + 1) + min);
}

function sample<T>(values: readonly T[], seed: number): T {
  if (values.length === 0) {
    throw new Error('Cannot sample from an empty array');
  }

  const index = seededInt(seed, 0, values.length - 1);

  const value = values[index];

  if (value === undefined) {
    throw new Error(`Unable to sample value at index ${index}`);
  }

  return value;
}

function createDateHoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * HOUR_MS);
}

function createDateDaysAgo(days: number, extraHours = 0): Date {
  return new Date(Date.now() - days * DAY_MS - extraHours * HOUR_MS);
}

/**
 * Removes only data created by this seed script.
 *
 * Existing development users and existing real posts are preserved.
 */
async function cleanupPreviousSeed(): Promise<void> {
  console.log('Cleaning previous feed seed data...');

  /**
   * Post deletes cascade:
   *
   * PostLike
   * PostTag
   * Comment
   * PostMedia
   */
  await prisma.post.deleteMany({
    where: {
      id: {
        startsWith: 'seed_post_',
      },
    },
  });

  /**
   * PostMedia is already deleted through Post cascade.
   * MediaUpload must be removed separately.
   */
  await prisma.mediaUpload.deleteMany({
    where: {
      id: {
        startsWith: 'seed_media_',
      },
    },
  });

  /**
   * Safety cleanup for seed comments from a previously
   * interrupted seed execution.
   */
  await prisma.comment.deleteMany({
    where: {
      id: {
        startsWith: 'seed_comment_',
      },
    },
  });

  /**
   * Deleting seed users cascades:
   *
   * UserFollow
   * GameMember
   * PostLike
   * Comments
   */
  await prisma.user.deleteMany({
    where: {
      id: {
        startsWith: 'seed_user_',
      },
    },
  });
}

async function seedUsers(): Promise<SeedUser[]> {
  console.log('Creating 30 development users...');

  for (let index = 0; index < USER_NAMES.length; index++) {
    const name = USER_NAMES[index];

    if (name === undefined) {
      continue;
    }

    const number = String(index + 1).padStart(2, '0');

    const userId = `seed_user_${number}`;

    await prisma.user.upsert({
      where: {
        id: userId,
      },

      create: {
        id: userId,

        name,

        email: `seed.${number}@gachahub.local`,

        emailVerified: true,

        role: UserRole.USER,

        status: UserStatus.ACTIVE,

        image: `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(
          name,
        )}`,
      },

      update: {
        name,

        status: UserStatus.ACTIVE,
      },
    });
  }

  return prisma.user.findMany({
    where: {
      OR: [
        {
          id: {
            startsWith: 'seed_user_',
          },
        },
        {
          id: {
            in: [...EXISTING_USER_IDS],
          },
        },
      ],

      status: UserStatus.ACTIVE,
    },

    select: {
      id: true,

      name: true,
    },
  });
}

async function seedGames(): Promise<SeedGame[]> {
  console.log('Creating/updating games...');

  const admin = await prisma.user.findUnique({
    where: {
      id: 'ksaIxdxyJum8IRLOhig5NXHW9dz8IEz7',
    },

    select: {
      id: true,
    },
  });

  const gameResults: SeedGame[] = [];

  for (const game of GAMES) {
    const result = await prisma.game.upsert({
      where: {
        slug: game.slug,
      },

      create: {
        name: game.name,

        slug: game.slug,

        description: game.description,

        developer: game.developer,

        publisher: game.publisher,

        status: GameStatus.ACTIVE,

        createdBy: admin?.id,
      },

      update: {
        name: game.name,

        description: game.description,

        developer: game.developer,

        publisher: game.publisher,

        status: GameStatus.ACTIVE,
      },

      select: {
        id: true,

        name: true,

        slug: true,
      },
    });

    gameResults.push(result);
  }

  return gameResults;
}

async function seedCategories(
  games: SeedGame[],
): Promise<Map<string, Map<string, string>>> {
  console.log('Creating game categories...');

  const categoryMap = new Map<string, Map<string, string>>();

  for (const game of games) {
    const perGame = new Map<string, string>();

    for (const [index, category] of CATEGORIES.entries()) {
      const created = await prisma.gameCategory.upsert({
        where: {
          gameId_slug: {
            gameId: game.id,

            slug: category.slug,
          },
        },

        create: {
          gameId: game.id,

          name: category.name,

          slug: category.slug,

          description: category.description,

          icon: category.icon,

          sortOrder: index + 1,

          isActive: true,
        },

        update: {
          name: category.name,

          description: category.description,

          icon: category.icon,

          sortOrder: index + 1,

          isActive: true,
        },
      });

      perGame.set(category.slug, created.id);
    }

    categoryMap.set(game.slug, perGame);
  }

  return categoryMap;
}

async function seedTags(): Promise<Map<string, string>> {
  console.log('Creating tags...');

  const tagMap = new Map<string, string>();

  for (const tagName of TAGS) {
    const slug = slugify(tagName);

    const tag = await prisma.tag.upsert({
      where: {
        slug,
      },

      create: {
        name: tagName,

        slug,
      },

      update: {
        name: tagName,
      },
    });

    tagMap.set(slug, tag.id);
  }

  return tagMap;
}

async function seedFollows(users: SeedUser[]): Promise<void> {
  console.log('Creating social graph...');

  const seedUsers = users.filter((user) => user.id.startsWith('seed_user_'));

  /**
   * These behave like small community creators.
   */
  const creatorIds = ['seed_user_01', 'seed_user_02', 'seed_user_03'];

  for (const user of seedUsers) {
    for (const creatorId of creatorIds) {
      if (user.id === creatorId) {
        continue;
      }

      await prisma.userFollow.upsert({
        where: {
          followerId_followingId: {
            followerId: user.id,

            followingId: creatorId,
          },
        },

        create: {
          followerId: user.id,

          followingId: creatorId,
        },

        update: {},
      });
    }
  }

  /**
   * Main Postman account follows five seeded users.
   *
   * Useful for testing /feed/latest social boost.
   */
  const mainUserExists = users.some((user) => user.id === MAIN_TEST_USER_ID);

  if (mainUserExists) {
    for (let index = 1; index <= 5; index++) {
      const targetId = `seed_user_${String(index).padStart(2, '0')}`;

      await prisma.userFollow.upsert({
        where: {
          followerId_followingId: {
            followerId: MAIN_TEST_USER_ID,

            followingId: targetId,
          },
        },

        create: {
          followerId: MAIN_TEST_USER_ID,

          followingId: targetId,
        },

        update: {},
      });
    }
  }

  if (seedUsers.length === 0) {
    return;
  }

  /**
   * Additional varied follow relationships.
   */
  for (let index = 0; index < seedUsers.length; index++) {
    const follower = seedUsers[index];

    if (!follower) {
      continue;
    }

    for (let offset = 1; offset <= 2; offset++) {
      const following = seedUsers[(index + offset * 4) % seedUsers.length];

      if (!following) {
        continue;
      }

      if (follower.id === following.id) {
        continue;
      }

      await prisma.userFollow.upsert({
        where: {
          followerId_followingId: {
            followerId: follower.id,

            followingId: following.id,
          },
        },

        create: {
          followerId: follower.id,

          followingId: following.id,
        },

        update: {},
      });
    }
  }
}

async function seedPosts(
  games: SeedGame[],

  categories: Map<string, Map<string, string>>,

  tags: Map<string, string>,

  users: SeedUser[],
): Promise<SeededPost[]> {
  console.log('Creating 120 posts...');

  const availableAuthors = users.filter(
    (user) => user.id !== 'ksaIxdxyJum8IRLOhig5NXHW9dz8IEz7',
  );

  if (availableAuthors.length === 0) {
    throw new Error('No available authors for seed posts');
  }

  const createdPosts: SeededPost[] = [];

  let globalIndex = 0;

  for (const game of games) {
    const gameCategories = categories.get(game.slug);

    if (!gameCategories) {
      throw new Error(`Categories missing for ${game.slug}`);
    }

    /**
     * Exactly 20 posts per game.
     */
    for (let gamePostIndex = 0; gamePostIndex < 20; gamePostIndex++) {
      globalIndex++;

      const postId = `seed_post_${String(globalIndex).padStart(3, '0')}`;

      const template = POST_TEMPLATES[gamePostIndex % POST_TEMPLATES.length];

      if (!template) {
        throw new Error(`Missing post template at index ${gamePostIndex}`);
      }

      /**
       * First five posts in each game are intentionally
       * authored by seed_user_01 -> seed_user_05.
       *
       * The main test account follows these users.
       */
      const followedAuthor = availableAuthors.find(
        (user) =>
          user.id === `seed_user_${String(gamePostIndex + 1).padStart(2, '0')}`,
      );

      const fallbackAuthor =
        availableAuthors[globalIndex % availableAuthors.length];

      const randomAuthor =
        availableAuthors[
          seededInt(globalIndex * 11, 0, availableAuthors.length - 1)
        ];

      const author =
        gamePostIndex < 5 ? (followedAuthor ?? fallbackAuthor) : randomAuthor;

      if (!author) {
        throw new Error('Unable to resolve seed post author');
      }

      let createdAt: Date;

      /**
       * Post age distribution:
       *
       * 0-4:
       * very fresh
       *
       * 5-11:
       * 1-5 days old
       *
       * 12-17:
       * 6-13 days old
       *
       * 18-19:
       * older than Trending 14-day window
       */
      if (gamePostIndex < 5) {
        createdAt = createDateHoursAgo(1 + gamePostIndex * 2);
      } else if (gamePostIndex < 12) {
        createdAt = createDateDaysAgo(
          seededInt(globalIndex, 1, 5),

          seededInt(globalIndex + 20, 0, 12),
        );
      } else if (gamePostIndex < 18) {
        createdAt = createDateDaysAgo(seededInt(globalIndex + 40, 6, 13));
      } else {
        createdAt = createDateDaysAgo(18 + gamePostIndex);
      }

      let likeTarget = seededInt(globalIndex * 2, 0, 18);

      let commentTarget = seededInt(globalIndex * 3, 0, 5);

      let saveCount = seededInt(globalIndex * 5, 0, 15);

      let shareCount = seededInt(globalIndex * 7, 0, 8);

      let viewCount = seededInt(globalIndex * 13, 30, 3500);

      /**
       * Fresh + strongly engaged.
       */
      if (gamePostIndex === 0) {
        likeTarget = 28;
        commentTarget = 10;
        saveCount = 25;
        shareCount = 14;
        viewCount = 6500;
      }

      /**
       * Very fresh but almost no engagement.
       */
      if (gamePostIndex === 1) {
        likeTarget = 1;
        commentTarget = 0;
        saveCount = 0;
        shareCount = 0;
        viewCount = 70;
      }

      /**
       * Older but highly engaged.
       *
       * Useful for testing freshness vs popularity.
       */
      if (gamePostIndex === 12) {
        likeTarget = 30;
        commentTarget = 12;
        saveCount = 35;
        shareCount = 18;
        viewCount = 9500;
      }

      /**
       * Add a few FOLLOWERS_ONLY control posts.
       */
      const visibility =
        gamePostIndex === 4 || gamePostIndex === 14
          ? PostVisibility.FOLLOWERS_ONLY
          : PostVisibility.PUBLIC;

      const categoryId = gameCategories.get(template.category);

      if (!categoryId) {
        throw new Error(
          `Missing category ${template.category} for ${game.slug}`,
        );
      }

      const title =
        `[SEED] ${game.name}: ` + `${template.title} #${gamePostIndex + 1}`;

      /**
       * A post receives:
       *
       * - 2 generic tags
       * - 1 game tag
       *
       * IMPORTANT:
       * generic samples can return the same tag.
       * Set removes duplicates before creating PostTag.
       */
      const selectedTags = [
        sample(TAGS, globalIndex * 3),

        sample(TAGS, globalIndex * 5 + 1),

        game.name,
      ];

      /**
       * FIX:
       *
       * PostTag has:
       * @@id([postId, tagId])
       *
       * Therefore the same tag cannot be attached twice
       * to the same post.
       */
      const uniqueSelectedTags = [...new Set(selectedTags)];

      const tagConnections: Array<{
        tagId: string;
      }> = [];

      for (const tagName of uniqueSelectedTags) {
        const slug = slugify(tagName);

        let tagId = tags.get(slug);

        if (!tagId) {
          const tag = await prisma.tag.upsert({
            where: {
              slug,
            },

            create: {
              name: tagName,

              slug,
            },

            update: {},
          });

          tagId = tag.id;

          tags.set(slug, tag.id);
        }

        /**
         * Extra safety:
         *
         * Even if selectedTags logic changes later,
         * do not push the same tagId twice.
         */
        const alreadyAdded = tagConnections.some(
          (connection) => connection.tagId === tagId,
        );

        if (!alreadyAdded) {
          tagConnections.push({
            tagId,
          });
        }
      }

      await prisma.post.create({
        data: {
          id: postId,

          authorId: author.id,

          gameId: game.id,

          categoryId,

          title,

          content:
            `${template.content}\n\n` +
            `This is deterministic development seed data for ${game.name}. ` +
            `Post number ${gamePostIndex + 1} intentionally has different ` +
            'age and engagement values for feed ranking tests.',

          type: template.type,

          status: PostStatus.PUBLISHED,

          visibility,

          isSpoiler: template.type === PostType.LORE && gamePostIndex % 2 === 0,

          viewCount,

          /**
           * These are updated later from actual
           * PostLike / Comment records.
           */
          reactionCount: 0,

          commentCount: 0,

          saveCount,

          shareCount,

          createdAt,

          tags: {
            create: tagConnections,
          },
        },
      });

      createdPosts.push({
        id: postId,

        authorId: author.id,

        gameId: game.id,

        type: template.type,

        commentTarget,

        likeTarget,
      });
    }
  }

  return createdPosts;
}

async function seedLikes(
  posts: SeededPost[],
  users: SeedUser[],
): Promise<void> {
  console.log('Creating post likes...');

  for (let postIndex = 0; postIndex < posts.length; postIndex++) {
    const post = posts[postIndex];

    if (!post) {
      continue;
    }

    const possibleUsers = users.filter((user) => user.id !== post.authorId);

    if (possibleUsers.length === 0) {
      continue;
    }

    const likeCount = Math.min(post.likeTarget, possibleUsers.length);

    for (let index = 0; index < likeCount; index++) {
      const liker =
        possibleUsers[(postIndex * 7 + index * 3) % possibleUsers.length];

      if (!liker) {
        continue;
      }

      await prisma.postLike.upsert({
        where: {
          postId_userId: {
            postId: post.id,

            userId: liker.id,
          },
        },

        create: {
          postId: post.id,

          userId: liker.id,

          createdAt: createDateHoursAgo(
            seededInt(postIndex * 5 + index, 0, 96),
          ),
        },

        update: {},
      });
    }

    /**
     * Keep reactionCount synchronized with
     * actual PostLike rows.
     */
    const actualCount = await prisma.postLike.count({
      where: {
        postId: post.id,
      },
    });

    await prisma.post.update({
      where: {
        id: post.id,
      },

      data: {
        reactionCount: actualCount,
      },
    });
  }
}

async function seedComments(
  posts: SeededPost[],
  users: SeedUser[],
): Promise<void> {
  console.log('Creating comments...');

  const commentMessages = [
    'This is actually really useful, thanks for sharing.',
    'I tested something similar and got roughly the same result.',
    'Interesting. I had not considered this approach.',
    'Does this still work with a more F2P setup?',
    'I would probably change one part of the build, but the idea is solid.',
    'This makes much more sense after reading the explanation.',
    'I am curious whether the next patch changes this.',
    'Good catch. I completely missed that detail.',
    'This team has been working surprisingly well for me too.',
    'I need to try this later.',
  ] as const;

  let commentNumber = 0;

  for (let postIndex = 0; postIndex < posts.length; postIndex++) {
    const post = posts[postIndex];

    if (!post) {
      continue;
    }

    const possibleUsers = users.filter((user) => user.id !== post.authorId);

    if (possibleUsers.length === 0) {
      continue;
    }

    const rootComments: SeedComment[] = [];

    for (let index = 0; index < post.commentTarget; index++) {
      commentNumber++;

      const commenter =
        possibleUsers[(postIndex * 5 + index) % possibleUsers.length];

      if (!commenter) {
        continue;
      }

      const message =
        commentMessages[(postIndex + index) % commentMessages.length];

      if (!message) {
        continue;
      }

      const comment = await prisma.comment.create({
        data: {
          id: `seed_comment_${String(commentNumber).padStart(4, '0')}`,

          postId: post.id,

          authorId: commenter.id,

          content: message,

          createdAt: createDateHoursAgo(seededInt(commentNumber, 0, 72)),
        },

        select: {
          id: true,
        },
      });

      rootComments.push(comment);
    }

    /**
     * Add one reply to some more active threads.
     */
    if (rootComments.length >= 3 && postIndex % 3 === 0) {
      commentNumber++;

      const parent = rootComments[0];

      const replier = possibleUsers[(postIndex + 7) % possibleUsers.length];

      if (parent && replier) {
        await prisma.comment.create({
          data: {
            id: `seed_comment_${String(commentNumber).padStart(4, '0')}`,

            postId: post.id,

            authorId: replier.id,

            parentId: parent.id,

            content:
              'Good point. I think this also depends on the account and available resources.',

            createdAt: createDateHoursAgo(seededInt(commentNumber, 0, 48)),
          },
        });
      }
    }

    /**
     * Keep commentCount synchronized with actual
     * non-deleted Comment records.
     */
    const actualCommentCount = await prisma.comment.count({
      where: {
        postId: post.id,

        deletedAt: null,
      },
    });

    await prisma.post.update({
      where: {
        id: post.id,
      },

      data: {
        commentCount: actualCommentCount,
      },
    });
  }
}

/**
 * Creates placeholder media data.
 *
 * No Cloudinary upload is performed.
 *
 * Comment out this function call in main()
 * if you do not want fake media rows.
 */
async function seedOptionalMedia(posts: SeededPost[]): Promise<void> {
  console.log('Creating placeholder media...');

  /**
   * One image for roughly every four posts.
   *
   * 120 posts => around 30 media rows.
   */
  const postsWithMedia = posts.filter((_post, index) => index % 4 === 0);

  for (let index = 0; index < postsWithMedia.length; index++) {
    const post = postsWithMedia[index];

    if (!post) {
      continue;
    }

    const number = String(index + 1).padStart(3, '0');

    const mediaId = `seed_media_${number}`;

    const publicId = `seed/gachahub/feed/${post.id}`;

    const assetId = `seed_asset_${post.id}`;

    const imageUrl = `https://picsum.photos/seed/${post.id}/1200/675`;

    await prisma.mediaUpload.create({
      data: {
        id: mediaId,

        userId: post.authorId,

        purpose: MediaPurpose.POST,

        resourceType: MediaResourceType.IMAGE,

        status: MediaUploadStatus.ATTACHED,

        assetId,

        publicId,

        secureUrl: imageUrl,

        format: 'jpg',

        width: 1200,

        height: 675,

        bytes: 250_000,

        uploadedAt: new Date(),

        attachedAt: new Date(),

        postMedia: {
          create: {
            postId: post.id,

            assetId,

            publicId,

            url: imageUrl,

            mediaType: PostMediaType.IMAGE,

            altText: 'Development feed placeholder image',

            sortOrder: 0,

            width: 1200,

            height: 675,

            bytes: 250_000,

            format: 'jpg',
          },
        },
      },
    });
  }
}

async function seedGameMemberships(
  games: SeedGame[],
  users: SeedUser[],
): Promise<void> {
  console.log('Creating game memberships...');

  const seedUsers = users.filter((user) => user.id.startsWith('seed_user_'));

  if (seedUsers.length === 0) {
    return;
  }

  for (let gameIndex = 0; gameIndex < games.length; gameIndex++) {
    const game = games[gameIndex];

    if (!game) {
      continue;
    }

    const membershipCount = 10 + gameIndex * 2;

    for (let index = 0; index < membershipCount; index++) {
      const user = seedUsers[(index + gameIndex * 3) % seedUsers.length];

      if (!user) {
        continue;
      }

      await prisma.gameMember.upsert({
        where: {
          gameId_userId: {
            gameId: game.id,

            userId: user.id,
          },
        },

        create: {
          gameId: game.id,

          userId: user.id,

          role: GameMemberRole.MEMBER,
        },

        update: {},
      });
    }

    const memberCount = await prisma.gameMember.count({
      where: {
        gameId: game.id,
      },
    });

    await prisma.game.update({
      where: {
        id: game.id,
      },

      data: {
        memberCount,
      },
    });
  }
}

async function updateGamePostCounts(games: SeedGame[]): Promise<void> {
  console.log('Updating game post counters...');

  for (const game of games) {
    const postCount = await prisma.post.count({
      where: {
        gameId: game.id,

        status: PostStatus.PUBLISHED,

        deletedAt: null,
      },
    });

    await prisma.game.update({
      where: {
        id: game.id,
      },

      data: {
        postCount,
      },
    });
  }
}

async function printSummary(): Promise<void> {
  const [users, games, categories, posts, follows, likes, comments, media] =
    await Promise.all([
      prisma.user.count(),

      prisma.game.count(),

      prisma.gameCategory.count(),

      prisma.post.count({
        where: {
          id: {
            startsWith: 'seed_post_',
          },
        },
      }),

      prisma.userFollow.count(),

      prisma.postLike.count({
        where: {
          postId: {
            startsWith: 'seed_post_',
          },
        },
      }),

      prisma.comment.count({
        where: {
          id: {
            startsWith: 'seed_comment_',
          },
        },
      }),

      prisma.postMedia.count({
        where: {
          postId: {
            startsWith: 'seed_post_',
          },
        },
      }),
    ]);

  console.log('');
  console.log('==============================');
  console.log(' GachaHub Feed Seed Complete');
  console.log('==============================');

  console.log(`Users:          ${users}`);

  console.log(`Games:          ${games}`);

  console.log(`Categories:     ${categories}`);

  console.log(`Seed posts:     ${posts}`);

  console.log(`Follows:        ${follows}`);

  console.log(`Seed likes:     ${likes}`);

  console.log(`Seed comments:  ${comments}`);

  console.log(`Seed media:     ${media}`);

  console.log('');
  console.log('Main feed test account:');

  console.log(MAIN_TEST_USER_ID);

  console.log('');
  console.log('Main account currently follows:');

  const following = await prisma.userFollow.findMany({
    where: {
      followerId: MAIN_TEST_USER_ID,
    },

    include: {
      following: {
        select: {
          id: true,

          name: true,
        },
      },
    },

    take: 20,
  });

  for (const follow of following) {
    console.log(`- ${follow.following.name} (${follow.following.id})`);
  }
}

async function main(): Promise<void> {
  console.log('');
  console.log('Starting GachaHub feed seed...');
  console.log('');

  await cleanupPreviousSeed();

  const users = await seedUsers();

  const games = await seedGames();

  const categories = await seedCategories(games);

  const tags = await seedTags();

  await seedFollows(users);

  const posts = await seedPosts(games, categories, tags, users);

  await seedLikes(posts, users);

  await seedComments(posts, users);

  /**
   * OPTIONAL:
   *
   * Comment this out if you do not want
   * development placeholder media.
   */
  await seedOptionalMedia(posts);

  await seedGameMemberships(games, users);

  await updateGamePostCounts(games);

  await printSummary();
}

void main()
  .catch((error: unknown) => {
    console.error('Feed seed failed:', error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
