const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { Resend } = require('resend');
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;
const Stripe = require('stripe'); 
const PDFDocument = require("pdfkit");
const bwipjs = require("bwip-js");
const { v4: uuidv4 } = require("uuid");

require('dotenv').config();

console.log('🔍 Checking environment variables:');
console.log('STRIPE_SECRET_KEY exists:', !!process.env.STRIPE_SECRET_KEY);
console.log('SUPABASE_PASSWORD exists:', !!process.env.SUPABASE_PASSWORD);
console.log('RESEND_API_KEY exists:', !!process.env.RESEND_API_KEY);

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// ==================== SUPABASE CONNECTION ====================
const pool = new Pool({
    host: process.env.SUPABASE_HOST,
    port: parseInt(process.env.SUPABASE_PORT) || 5432,
    user: process.env.SUPABASE_USER,
    password: process.env.SUPABASE_PASSWORD,
    database: process.env.SUPABASE_DATABASE,
    ssl: { rejectUnauthorized: false }
});

const testConnection = async () => {
    try {
        const client = await pool.connect();
        console.log('✅ PostgreSQL Connected Successfully to Supabase');
        const result = await client.query('SELECT NOW() as time');
        console.log('📅 Database time:', result.rows[0].time);
        client.release();
    } catch (err) {
        console.error('❌ PostgreSQL Connection Failed:', err.message);
    }
};
testConnection();

const query = async (text, params) => {
    try {
        return await pool.query(text, params);
    } catch (err) {
        console.error('❌ Query error:', err.message);
        throw err;
    }
};

let adminOtpStore = {};
let otpStore = {};

// ==================== TEST APIs ====================

app.get('/api/test', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Server is working!', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

app.get('/api/test-db', async (req, res) => {
    try {
        const result = await query('SELECT NOW() as time, COUNT(*) as user_count FROM "user"');
        res.json({ 
            success: true, 
            message: 'Database connected!',
            time: result.rows[0].time,
            userCount: parseInt(result.rows[0].user_count)
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Database connection failed', error: err.message });
    }
});

// ==================== USER AUTH ====================

app.post('/api/check-email', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ exists: false, message: 'Email is required' });

    try {
        const result = await query('SELECT * FROM "user" WHERE email = $1', [email]);
        if (result.rows.length > 0) {
            res.json({ exists: true, user: { username: result.rows[0].username, email: result.rows[0].email } });
        } else {
            res.json({ exists: false, message: 'Email not found' });
        }
    } catch (err) {
        console.error('❌ Database error:', err);
        return res.status(500).json({ exists: false, message: 'Database error' });
    }
});

app.post('/api/send-otp', async (req, res) => {
    const { email } = req.body;
    console.log('📧 Sending OTP to:', email);

    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    try {
        const result = await query('SELECT * FROM "user" WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Email not registered' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const username = result.rows[0].username;

        otpStore[email] = { otp, expires: Date.now() + 5 * 60 * 1000 };
        console.log('🔐 Generated OTP for', email, ':', otp);

        const { error: emailError } = await resend.emails.send({
            from: 'Smart Museum Jaipur <onboarding@resend.dev>',
            to: email,
            subject: 'Password Reset OTP - Smart Museum Jaipur',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #e94560;">Smart Museum Jaipur</h2>
                    <h3>Password Reset Request</h3>
                    <p>Hello ${username},</p>
                    <p>Use the OTP below to verify your identity:</p>
                    <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0;">
                        <h1 style="color: #e94560; font-size: 32px; letter-spacing: 5px; margin: 0;">${otp}</h1>
                    </div>
                    <p>This OTP will expire in 5 minutes.</p>
                    <p>If you didn't request this, please ignore this email.</p>
                    <br>
                    <p>Best regards,<br>Smart Museum Jaipur Team</p>
                </div>
            `
        });

        if (emailError) {
            console.error('❌ Error sending OTP:', emailError);
            return res.status(500).json({ success: false, message: 'Failed to send OTP. Please try again.' });
        }

        console.log('✅ OTP sent successfully to:', email);
        res.json({ success: true, message: 'OTP sent successfully to your email', otp });

    } catch (err) {
        console.error('❌ Database error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.post('/api/verify-otp', (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and OTP are required' });

    const storedOtpData = otpStore[email];
    if (!storedOtpData) return res.status(400).json({ success: false, message: 'OTP not found or expired' });

    if (Date.now() > storedOtpData.expires) {
        delete otpStore[email];
        return res.status(400).json({ success: false, message: 'OTP has expired' });
    }

    if (storedOtpData.otp === otp) {
        delete otpStore[email];
        console.log('✅ OTP verified successfully for:', email);
        res.json({ success: true, message: 'OTP verified successfully' });
    } else {
        res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
});

app.post('/api/reset-password', async (req, res) => {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ success: false, message: 'Email and new password are required' });

    try {
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
        const result = await query('UPDATE "user" SET password = $1 WHERE email = $2', [hashedPassword, email]);
        if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'User not found' });

        console.log('✅ Password reset successful for:', email);
        res.json({ success: true, message: 'Password reset successfully' });
    } catch (err) {
        console.error('❌ Database error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.post('/api/register', async (req, res) => {
    const { username, email, phone_number, gender, age, password } = req.body;
    if (!username || !email || !phone_number || !password) {
        return res.status(400).json({ success: false, message: 'All required fields must be filled!' });
    }

    try {
        const emailResult = await query('SELECT user_id FROM "user" WHERE email = $1', [email]);
        if (emailResult.rows.length > 0) return res.status(400).json({ success: false, message: 'Email already exists!' });

        const usernameResult = await query('SELECT user_id FROM "user" WHERE username = $1', [username]);
        if (usernameResult.rows.length > 0) return res.status(400).json({ success: false, message: 'Username already exists!' });

        const genderMap = { male: 'Male', female: 'Female', other: 'Other', 'prefer-not-to-say': 'Other' };
        const dbGender = genderMap[gender] || 'Other';

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        const insertResult = await query(
            'INSERT INTO "user" (username, email, phone_number, gender, age, password) VALUES ($1, $2, $3, $4, $5, $6) RETURNING user_id',
            [username, email, phone_number, dbGender, age || null, hashedPassword]
        );

        console.log('✅ User registered. ID:', insertResult.rows[0].user_id);
        res.json({ success: true, message: 'Registration successful!', user_id: insertResult.rows[0].user_id, username });

    } catch (err) {
        console.error('❌ Registration error:', err);
        return res.status(500).json({ success: false, message: 'Registration failed!', error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password are required!' });

    try {
        const result = await query('SELECT * FROM "user" WHERE username = $1', [username]);
        if (result.rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid username or password!' });

        const user = result.rows[0];
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) return res.status(401).json({ success: false, message: 'Invalid username or password!' });

        console.log("✅ Login successful, user_id:", user.user_id);
        res.json({
            success: true, message: 'Login successful!',
            user: { user_id: user.user_id, username: user.username, email: user.email, phone_number: user.phone_number, gender: user.gender, age: user.age }
        });
    } catch (err) {
        console.error('❌ Login error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
    }
});

app.get("/api/user/:id", async (req, res) => {
    try {
        const result = await query('SELECT username, email, phone_number, gender, age FROM "user" WHERE user_id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.send({ success: false });
        res.send({ success: true, user: result.rows[0] });
    } catch (err) {
        res.send({ success: false, error: err.message });
    }
});

app.put('/api/edit-profile', async (req, res) => {
    const { userId, email, phone_number } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'userId is required' });

    try {
        const result = await query('UPDATE "user" SET email = $1, phone_number = $2 WHERE user_id = $3', [email, phone_number, userId]);
        if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Database error', error: err.message });
    }
});

// ==================== ADMIN AUTH ====================

app.post("/api/admin/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: "Username and password required" });

    try {
        const result = await query("SELECT * FROM admin WHERE username = $1", [username]);
        if (result.rows.length === 0) return res.status(401).json({ success: false, message: "Invalid admin username or password" });

        const admin = result.rows[0];
        if (admin.password !== password) return res.status(401).json({ success: false, message: "Invalid admin username or password" });

        console.log("✅ Admin logged in successfully");
        return res.json({ success: true, message: "Signed in successfully", admin: { username: admin.username, email: admin.email } });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Database error" });
    }
});

app.post("/api/admin/send-otp", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email required" });

    try {
        const result = await query("SELECT * FROM admin WHERE email = $1", [email]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Admin email not registered" });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        adminOtpStore[email] = { otp, expires: Date.now() + 5 * 60 * 1000 };

        const { error: emailErr } = await resend.emails.send({
            from: 'Smart Museum Jaipur <onboarding@resend.dev>',
            to: email,
            subject: 'Admin OTP - Smart Museum',
            html: `<h2>Admin Password Reset</h2><h1>${otp}</h1>`
        });

        if (emailErr) return res.status(500).json({ success: false, message: "Email failed" });
        res.json({ success: true, message: "OTP sent" });

    } catch (err) {
        return res.status(500).json({ success: false, message: "DB error" });
    }
});

app.post("/api/admin/verify-otp", (req, res) => {
    const { email, otp } = req.body;
    const stored = adminOtpStore[email];
    if (!stored || stored.otp !== otp || Date.now() > stored.expires) {
        return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }
    res.json({ success: true });
});

app.post("/api/admin/reset-password", async (req, res) => {
    const { email, newPassword } = req.body;
    try {
        await query("UPDATE admin SET password = $1 WHERE email = $2", [newPassword, email]);
        delete adminOtpStore[email];
        res.json({ success: true, message: "Password reset successful" });
    } catch (err) {
        return res.status(500).json({ success: false });
    }
});

// ==================== MUSEUMS ====================

app.get("/api/museums", async (req, res) => {
    const { city, category } = req.query;
    let sql = 'SELECT id, name, description, open_time, close_time, main_image, city, category FROM museums WHERE 1=1';
    let params = [];
    let paramCounter = 1;

    if (city && city !== "ALL") { sql += ` AND city = $${paramCounter}`; params.push(city); paramCounter++; }
    if (category) { sql += ` AND category = $${paramCounter}`; params.push(category); paramCounter++; }
    sql += " ORDER BY id ASC";

    try {
        const result = await query(sql, params);
        res.json(result.rows);
    } catch (err) {
        return res.status(500).json({ success: false, message: "Database error" });
    }
});

app.get('/api/museum/:id', async (req, res) => {
    try {
        const result = await query('SELECT * FROM museums WHERE id = $1', [req.params.id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).send(err); }
});

app.get('/api/museum/:id/tickets', async (req, res) => {
    try {
        const result = await query('SELECT * FROM tickets WHERE museum_id = $1', [req.params.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).send(err); }
});

app.get('/api/museum/:id/gallery', async (req, res) => {
    try {
        const result = await query('SELECT * FROM gallery WHERE museum_id = $1', [req.params.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).send(err); }
});

app.delete("/api/museum/:id", async (req, res) => {
    try {
        const result = await query("DELETE FROM museums WHERE id = $1", [req.params.id]);
        if (result.rowCount === 0) return res.json({ success: false });
        res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false }); }
});

// ==================== ADMIN MUSEUM MANAGEMENT ====================

app.get('/api/admin/museum/:id', async (req, res) => {
    try {
        const result = await query('SELECT * FROM museums WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Museum not found" });
        res.json(result.rows[0]);
    } catch (err) { return res.status(500).json({ success: false }); }
});

app.post("/api/admin/museum", async (req, res) => {
    const { name, description, address, open_time, close_time, main_image, city, category } = req.body;
    try {
        const result = await query(
            'INSERT INTO museums (name, description, address, open_time, close_time, main_image, city, category) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
            [name, description, address, open_time, close_time, main_image, city, category]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) { return res.status(500).json({ success: false }); }
});

app.put('/api/admin/museum/:id', async (req, res) => {
    const { name, description, address, open_time, close_time, main_image, city, category } = req.body;
    try {
        await query(
            'UPDATE museums SET name=$1, description=$2, address=$3, open_time=$4, close_time=$5, main_image=$6, city=$7, category=$8 WHERE id=$9',
            [name, description, address, open_time, close_time, main_image, city, category, req.params.id]
        );
        res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false }); }
});

app.get('/api/admin/museum/:id/gallery', async (req, res) => {
    try {
        const result = await query('SELECT * FROM gallery WHERE museum_id = $1', [req.params.id]);
        res.json(result.rows);
    } catch (err) { return res.status(500).json([]); }
});

app.post('/api/admin/gallery', async (req, res) => {
    const { museum_id, image_url } = req.body;
    if (!museum_id || !image_url) return res.status(400).json({ success: false, message: "Missing data" });
    try {
        await query('INSERT INTO gallery (museum_id, image_url) VALUES ($1, $2)', [museum_id, image_url]);
        res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false }); }
});

app.put('/api/admin/gallery/:id', async (req, res) => {
    try {
        await query('UPDATE gallery SET image_url=$1 WHERE id=$2', [req.body.image_url, req.params.id]);
        res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false }); }
});

app.delete('/api/admin/gallery/:id', async (req, res) => {
    try {
        await query('DELETE FROM gallery WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false }); }
});

app.get('/api/admin/museum/:id/tickets', async (req, res) => {
    try {
        const result = await query('SELECT * FROM tickets WHERE museum_id = $1', [req.params.id]);
        res.json(result.rows);
    } catch (err) { return res.status(500).json([]); }
});

app.post('/api/admin/ticket', async (req, res) => {
    const { museum_id, type, price } = req.body;
    if (!museum_id || !type || !price) return res.status(400).json({ success: false, message: "Missing data" });
    try {
        await query('INSERT INTO tickets (museum_id, type, price) VALUES ($1, $2, $3)', [museum_id, type, price]);
        res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false }); }
});

app.put('/api/admin/ticket/:id', async (req, res) => {
    const { type, price } = req.body;
    try {
        await query('UPDATE tickets SET type=$1, price=$2 WHERE id=$3', [type, price, req.params.id]);
        res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false }); }
});

app.delete('/api/admin/ticket/:id', async (req, res) => {
    try {
        await query('DELETE FROM tickets WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false }); }
});

// ==================== ADMIN USERS & BOOKINGS ====================

app.get("/api/admin/users", async (req, res) => {
    try {
        const result = await query('SELECT user_id, username, email, phone_number, gender, age FROM "user" ORDER BY user_id');
        res.json({ success: true, users: result.rows });
    } catch (err) { return res.status(500).json({ success: false, message: "Database error" }); }
});

app.get("/api/admin/bookings", async (req, res) => {
    try {
        const countResult = await query("SELECT COUNT(*) as count FROM booking");
        if (parseInt(countResult.rows[0].count) === 0) return res.json({ success: true, bookings: [] });

        const result = await query(`
            SELECT b.booking_id, b.name,
                COALESCE(m.name, 'Unknown Museum') AS museum_name,
                TO_CHAR(b.visit_date, 'YYYY-MM-DD') as visit_date,
                b.num_adults, b.num_children, b.amount_paid, b.payment_status,
                TO_CHAR(b.booking_date, 'YYYY-MM-DD HH24:MI:SS') as booking_date
            FROM booking b
            LEFT JOIN museums m ON b.museum_id = m.id
            ORDER BY b.booking_date DESC
        `);
        res.json({ success: true, bookings: result.rows });
    } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
});

// ==================== STRIPE PAYMENT ====================

app.post("/api/create-checkout-session", async (req, res) => {
    try {
        const { museumName, ticketType, email, visitDate, amount, museumId, userName, userAge, phoneNumber, gender, userId } = req.body;

        if (!email) return res.status(400).json({ success: false, message: "Email is required" });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{
                price_data: {
                    currency: "inr",
                    product_data: { name: museumName || "Museum Entry Ticket", description: ticketType || "Museum visit ticket" },
                    unit_amount: Math.round(amount * 100),
                },
                quantity: 1,
            }],
            mode: "payment",
            metadata: {
                museumName, ticketType, email, visitDate,
                museumId: museumId || "",
                userName: userName || "",
                userAge: userAge || "",
                phoneNumber: phoneNumber || "",
                gender: gender || "",
                userId: userId || ""
            },
            success_url: "https://museum-rosy.vercel.app/payment-success.html?session_id={CHECKOUT_SESSION_ID}",
            cancel_url: "https://museum-rosy.vercel.app/payment-cancel.html",
        });

        console.log("✅ Session created:", session.id);
        res.json({ success: true, url: session.url, sessionId: session.id });

    } catch (error) {
        console.error("❌ Stripe error:", error);
        res.status(500).json({ success: false, message: "Stripe payment failed", error: error.message });
    }
});

app.get("/api/payment-success", async (req, res) => {
    console.log("\n🔥 PAYMENT SUCCESS API CALLED");

    try {
        const session = await stripe.checkout.sessions.retrieve(req.query.session_id);

        if (session.payment_status !== "paid") {
            return res.json({ success: false, error: "Payment not completed" });
        }

        const { museumName, ticketType, email, visitDate, museumId, userName, userAge, phoneNumber, gender, userId } = session.metadata;

        if (!email) return res.json({ success: false, error: "Email not found in session" });

        let finalGender = "Other";
        if (gender) {
            const g = gender.toLowerCase().trim();
            if (g === 'male' || g === 'm') finalGender = 'Male';
            else if (g === 'female' || g === 'f') finalGender = 'Female';
        }

        const bookingId = uuidv4().substring(0, 20);

        let adult = 1, child = 0;
        if (ticketType) {
            const numbers = ticketType.match(/\d+/g);
            if (numbers) { adult = parseInt(numbers[0]) || 1; child = parseInt(numbers[1]) || 0; }
        }

        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60 * 1000) + istOffset);
        const bookingDate = `${istTime.getFullYear()}-${String(istTime.getMonth()+1).padStart(2,'0')}-${String(istTime.getDate()).padStart(2,'0')} ${String(istTime.getHours()).padStart(2,'0')}:${String(istTime.getMinutes()).padStart(2,'0')}:${String(istTime.getSeconds()).padStart(2,'0')}`;

        // Create PDF
        const buffers = [];
        const doc = new PDFDocument();
        doc.on("data", buffers.push.bind(buffers));

        doc.on("end", async () => {
            const pdfData = Buffer.concat(buffers);

            // Send email
            try {
                const { error: emailError } = await resend.emails.send({
                    from: 'Smart Museum Jaipur <onboarding@resend.dev>',
                    to: email,
                    subject: 'Your Museum Ticket - Smart Museum Jaipur 🎟️',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px;">
                            <h2 style="color: #e94560;">Smart Museum Jaipur</h2>
                            <p>Thank you for your purchase!</p>
                            <div style="background: #f5f5f5; padding: 20px; border-radius: 10px; margin: 20px 0;">
                                <h3>Booking Details:</h3>
                                <p><strong>Booking ID:</strong> ${bookingId}</p>
                                <p><strong>Name:</strong> ${userName || "Guest"}</p>
                                <p><strong>Email:</strong> ${email}</p>
                                <p><strong>Phone:</strong> ${phoneNumber || "Not provided"}</p>
                                <p><strong>Museum:</strong> ${museumName}</p>
                                <p><strong>Visit Date:</strong> ${visitDate}</p>
                                <p><strong>Visitors:</strong> ${adult} Adult(s), ${child} Child(ren)</p>
                                <p><strong>Amount Paid:</strong> ₹${(session.amount_total / 100).toFixed(2)}</p>
                                <p><strong>Booking Date:</strong> ${new Date().toLocaleString()}</p>
                            </div>
                            <p>Please show the attached ticket at the entrance.</p>
                            <br>
                            <p>Best regards,<br>Smart Museum Jaipur Team</p>
                        </div>
                    `,
                    attachments: [{
                        filename: `ticket-${bookingId}.pdf`,
                        content: pdfData.toString('base64'),
                    }]
                });

                if (emailError) {
                    console.log("❌ EMAIL ERROR:", emailError.message);
                } else {
                    console.log("✅ EMAIL SENT SUCCESSFULLY");
                }
            } catch (emailError) {
                console.log("❌ EMAIL EXCEPTION:", emailError.message);
            }

            // Save to database
            try {
                await query(`
                    INSERT INTO booking (
                        booking_id, name, age, email, phone_number, gender,
                        visit_date, num_adults, num_children, amount_paid,
                        user_id, museum_id, booking_date, payment_status, stripe_session_id, is_used
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
                `, [
                    bookingId,
                    userName || "Guest",
                    userAge ? parseInt(userAge) : null,
                    email,
                    phoneNumber || null,
                    finalGender,
                    visitDate,
                    adult,
                    child,
                    Math.round(session.amount_total / 100),
                    (userId && !isNaN(parseInt(userId))) ? parseInt(userId) : null,
                    museumId ? parseInt(museumId) : null,
                    bookingDate,
                    "PAID",
                    session.id,
                    false
                ]);

                console.log("✅ Booking saved:", bookingId);
                res.json({ success: true, message: "Booking confirmed!", bookingId });

            } catch (dbError) {
                console.error("❌ DB Save Error:", dbError);
                return res.json({ success: false, error: "Database save failed", details: dbError.message, bookingId });
            }
        });

        // Build PDF content
        doc.fontSize(24).text("SMART MUSEUM JAIPUR", { align: "center" });
        doc.moveDown();
        doc.fontSize(16).text("ENTRY TICKET", { align: "center" });
        doc.moveDown(2);
        doc.fontSize(12);
        doc.text(`Booking ID: ${bookingId}`);
        doc.text(`Name: ${userName || "Guest"}`);
        doc.text(`Email: ${email}`);
        doc.text(`Phone: ${phoneNumber || "N/A"}`);
        doc.moveDown();
        doc.text(`Museum: ${museumName}`);
        doc.text(`Visit Date: ${visitDate}`);
        doc.text(`Booking Date: ${new Date().toLocaleString()}`);
        doc.moveDown();
        doc.text(`Adults: ${adult}, Children: ${child}`);
        doc.moveDown();
        doc.text(`Amount Paid: ₹${(session.amount_total / 100).toFixed(2)}`);
        doc.moveDown(2);

        try {
            const barcode = await bwipjs.toBuffer({ bcid: "code128", text: bookingId, scale: 3, height: 10, includetext: true });
            doc.image(barcode, { width: 250, align: "center" });
        } catch (barcodeError) {
            console.log("❌ Barcode error:", barcodeError);
        }

        doc.moveDown();
        doc.fontSize(10).text("Please show this ticket at the entrance.", { align: "center" });
        doc.end();

    } catch (err) {
        console.log("❌ ERROR in payment-success:", err);
        res.json({ success: false, error: err.message });
    }
});

// ==================== BOOKINGS ====================

app.get("/api/booking/:id", async (req, res) => {
    try {
        const result = await query("SELECT * FROM booking WHERE booking_id = $1", [req.params.id]);
        res.json(result.rows[0] || {});
    } catch (err) { return res.status(500).json({ success: false }); }
});

app.get("/api/user/:userId/bookings", async (req, res) => {
    const userId = req.params.userId;
    try {
        const result = await query(`
            SELECT b.booking_id, b.name, b.visit_date, b.num_adults, b.num_children,
                b.amount_paid, b.payment_status, b.museum_id, b.booking_date, b.is_used,
                m.name as museum_name
            FROM booking b
            LEFT JOIN museums m ON b.museum_id = m.id
            WHERE b.user_id = $1
            ORDER BY b.booking_date DESC
        `, [userId]);
        res.json({ success: true, bookings: result.rows });
    } catch (err) { return res.status(500).json({ success: false, message: "Database error" }); }
});

// ==================== ADMIN DASHBOARD ====================

app.get('/api/admin/stats', async (req, res) => {
    try {
        const [museums, users, bookings, revenue, totalRevenue, visitors] = await Promise.all([
            query("SELECT COUNT(*) as count FROM museums"),
            query('SELECT COUNT(*) as count FROM "user"'),
            query("SELECT COUNT(*) as count FROM booking"),
            query("SELECT COALESCE(SUM(amount_paid), 0) as total FROM booking WHERE DATE(booking_date) = CURRENT_DATE"),
            query("SELECT COALESCE(SUM(amount_paid), 0) as total FROM booking"),
            query("SELECT COUNT(DISTINCT booking_id) as count FROM booking WHERE DATE(booking_date) = CURRENT_DATE")
        ]);

        res.json({
            totalMuseums: parseInt(museums.rows[0].count),
            totalUsers: parseInt(users.rows[0].count),
            totalBookings: parseInt(bookings.rows[0].count),
            todayRevenue: parseFloat(revenue.rows[0].total),
            totalRevenue: parseFloat(totalRevenue.rows[0].total),
            todayVisitors: parseInt(visitors.rows[0].count)
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/admin/monthly-revenue', async (req, res) => {
    try {
        const result = await query(`
            SELECT TO_CHAR(booking_date, 'YYYY-MM') as month, SUM(amount_paid) as total_revenue
            FROM booking WHERE booking_date IS NOT NULL
            GROUP BY TO_CHAR(booking_date, 'YYYY-MM')
            ORDER BY month ASC LIMIT 6
        `);

        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const months = [], revenues = [];

        result.rows.forEach(row => {
            const [year, month] = row.month.split('-');
            months.push(`${monthNames[parseInt(month)-1]} ${year}`);
            revenues.push(parseFloat(row.total_revenue));
        });

        if (months.length === 0) {
            res.json({ months: ['Jan','Feb','Mar','Apr','May','Jun'], revenues: [1250,2340,1890,3120,2780,4120] });
        } else {
            res.json({ months, revenues });
        }
    } catch (error) {
        res.json({ months: ['Jan','Feb','Mar','Apr','May','Jun'], revenues: [0,0,0,0,0,0] });
    }
});

app.get('/api/admin/popular-museums', async (req, res) => {
    try {
        const result = await query(`
            SELECT COALESCE(m.name, 'Unknown Museum') as name, COUNT(b.booking_id) as "bookingCount"
            FROM museums m
            LEFT JOIN booking b ON m.id = b.museum_id
            GROUP BY m.id, m.name
            ORDER BY "bookingCount" DESC LIMIT 5
        `);
        res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/admin/recent-bookings', async (req, res) => {
    try {
        const result = await query(`
            SELECT b.booking_id as id, COALESCE(b.name, 'Guest') as "userName",
                COALESCE(m.name, 'Museum ID: ' || b.museum_id) as "museumName",
                TO_CHAR(b.booking_date, 'YYYY-MM-DD HH24:MI:SS') as "bookingDate",
                TO_CHAR(b.visit_date, 'YYYY-MM-DD') as "visitDate",
                b.amount_paid as amount, b.payment_status as status
            FROM booking b
            LEFT JOIN museums m ON b.museum_id = m.id
            ORDER BY b.booking_date DESC LIMIT 10
        `);
        res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.listen(process.env.PORT || 5000, () => {
    console.log(`🚀 Server running on port ${process.env.PORT || 5000}`);
});
