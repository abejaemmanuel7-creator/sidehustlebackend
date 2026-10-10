const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const db = new Pool({ connectionString: process.env.DATABASE_URL });

// Wake up and connect the background reset cron process loops
require('./cron.js');

// MERCHANT PAYMENT ENDPOINT ROUTINES
app.post('/api/gateway/deposit', async (req, res) => {
    const { userId, carrier, paymentNumber, amountUgx } = req.body;
    if (amountUgx < 5000) return res.status(400).json({ error: "Min: 5,000" });

    let merchantName = "External Subscriber Node";
    if (carrier === 'mtn' && paymentNumber === '0762320271') merchantName = "Abeja Emmanuel";
    if (carrier === 'airtel' && paymentNumber === '0758582548') merchantName = "Ogoro Benson Allan";

    try {
        await db.query('BEGIN');
        const updatedUser = await db.query(
            `UPDATE users SET available_balance_ugx = available_balance_ugx + $1 WHERE id = $2 RETURNING *`,
            [amountUgx, userId]
        );
        await db.query(
            `INSERT INTO transactions (user_id, type, status, carrier, subscriber_number, subscriber_legal_name, gross_amount_ugx, net_payout_ugx) VALUES ($1, 'deposit', 'completed', $2, $3, $4, $5, $5)`,
            [userId, carrier, paymentNumber, merchantName, amountUgx]
        );

        // MULTI-LEVEL AFFILIATE SPLIT RUN ROUTINE (20% / 5% / 3%)
        let currentInviterId = updatedUser.rows[0].invited_by_id;
        const rates = [0.20, 0.05, 0.03]; 
        const logTypes = ['level_1_bonus', 'level_2_bonus', 'level_3_bonus'];

        for (let i = 0; i < rates.length; i++) {
            if (!currentInviterId) break; 
            const bonusReward = amountUgx * rates[i];
            const inviter = await db.query(
                `UPDATE users SET available_balance_ugx = available_balance_ugx + $1, total_earnings_ugx = total_earnings_ugx + $1 WHERE id = $2 RETURNING invited_by_id`,
                [bonusReward, currentInviterId]
            );
            await db.query(`INSERT INTO transactions (user_id, type, status, gross_amount_ugx, net_payout_ugx) VALUES ($1, $2, 'completed', $3, $3)`, [currentInviterId, logTypes[i], bonusReward]);
            currentInviterId = inviter.rows[0].invited_by_id; 
        }

        await db.query('COMMIT');
        res.status(200).json({ status: "Success", receiver: merchantName });
    } catch (error) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: "Gateway failure." });
    }
});

// DAILY TASK CLAIM HANDLER
app.post('/api/errands/execute', async (req, res) => {
    const { userId } = req.body;
    try {
        const userCheck = await db.query('SELECT is_daily_task_completed, active_vip_tier FROM users WHERE id = \$1', [userId]);
        if (userCheck.rows[0].is_daily_task_completed) return res.status(400).json({ error: "Already done." });

        const yieldMap = { 1: 1500, 2: 3000, 3: 6000, 4: 11000, 5: 25000, 6: 41000, 7: 150000, 8: 400000 };
        const reward = yieldMap[userCheck.rows[0].active_vip_tier] || 0;

        await db.query('BEGIN');
        await db.query(`UPDATE users SET available_balance_ugx = available_balance_ugx + $1, total_earnings_ugx = total_earnings_ugx + $1, is_daily_task_completed = TRUE WHERE id = $2`, [reward, userId]);
        await db.query(`INSERT INTO transactions (user_id, type, status, gross_amount_ugx, net_payout_ugx) VALUES ($1, 'task_yield', 'completed', $2, $2)`, [userId, reward]);
        await db.query('COMMIT');
        res.status(200).json({ yield: reward });
    } catch (error) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: "Task matrix error." });
    }
});

app.listen(3000, () => console.log('Backend engine terminal active on port 3000.'));
