const cron = require('node-cron');
const { Pool } = require('pg');
const db = new Pool({ connectionString: process.env.DATABASE_URL });

cron.schedule('0 0 * * *', async () => {
    console.log('⏰ Initializing automated midnight task yield resetting cycle...');
    try {
        await db.query('UPDATE users SET is_daily_task_completed = FALSE');
        console.log('✅ Daily platforms task flags updated back to base status elements successfully.');
    } catch (error) {
        console.error('❌ Reset cycle failure encountered:', error);
    }
}, {
    scheduled: true,
    timezone: "Africa/Kampala"
});
