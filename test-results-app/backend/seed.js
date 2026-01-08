const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/User');
const Job = require('./models/Job');

const seedData = {
  "hamimalam@outlook.com": {
    "job1": ["test.js", "test1.js"],
    "job2": ["hello.js"]
  },
  "another.user@email.com": {
    "job3": ["test3.js", "test4.js"],
    "job4": ["hello1.js"]
  }
};

const DEFAULT_PASSWORD = 'password123';

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing data
    await User.deleteMany({});
    await Job.deleteMany({});
    console.log('Cleared existing data');

    for (const [email, jobs] of Object.entries(seedData)) {
      // Create user (password will be hashed by User model pre-save hook)
      const user = await User.create({
        email,
        password: DEFAULT_PASSWORD,
        name: email.split('@')[0]
      });
      console.log(`Created user: ${email}`);

      // Create jobs for this user
      for (const [jobName, files] of Object.entries(jobs)) {
        await Job.create({
          name: jobName,
          owner: user._id,
          files,
          description: `Seeded job: ${jobName}`
        });
        console.log(`  Created job: ${jobName} with files: ${files.join(', ')}`);
      }
    }

    console.log('\nSeeding complete!');
    console.log(`\nLogin credentials (password for all: ${DEFAULT_PASSWORD}):`);
    Object.keys(seedData).forEach(email => console.log(`  - ${email}`));

    await mongoose.disconnect();
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
}

seed();
