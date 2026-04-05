const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require("nodemailer");
const Stripe = require('stripe'); // Change this line
const PDFDocument = require("pdfkit");
const bwipjs = require("bwip-js");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require('bcrypt');



// Load environment variables - IMPORTANT: Yeh sabse pehle hona chahiye
require('dotenv').config();

// Debug: Check if environment variables are loaded
console.log('🔍 Checking environment variables:');
console.log('STRIPE_SECRET_KEY exists:', !!process.env.STRIPE_SECRET_KEY);
console.log('SUPABASE_PASSWORD exists:', !!process.env.SUPABASE_PASSWORD);
console.log('EMAIL_USER exists:', !!process.env.EMAIL_USER);


// Initialize Stripe with the secret key
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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
    ssl: {
        rejectUnauthorized: false
    }
});

// Test connection
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

// Helper function for queries
const query = async (text, params) => {
    try {
        return await pool.query(text, params);
    } catch (err) {
        console.error('❌ Query error:', err.message);
        throw err;
    }
};

// ==================== EMAIL CONFIGURATION ====================
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    },
    pool: true,
    maxConnections: 1
});

transporter.verify(function(error, success) {
    if (error) {
        console.log('❌ Email connection FAILED:', error);
    } else {
        console.log('✅ Email server is ready to send messages');
    }
});

let adminOtpStore = {};
let otpStore = {};


// TEST API
app.get('/api/test', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Server is working!', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// TEST DATABASE CONNECTION API
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
        res.status(500).json({ 
            success: false, 
            message: 'Database connection failed',
            error: err.message 
        });
    }
});

// ✅ CHECK EMAIL API
app.post('/api/check-email', async (req, res) => {
    const { email } = req.body;
    console.log('🔍 Checking email:', email);

    if (!email) {
        return res.status(400).json({
            exists: false,
            message: 'Email is required'
        });
    }

    try {
        const queryText = 'SELECT * FROM "user" WHERE email = $1';
        const result = await query(queryText, [email]);

        if (result.rows.length > 0) {
            res.json({
                exists: true,
                user: {
                    username: result.rows[0].username,
                    email: result.rows[0].email
                }
            });
        } else {
            res.json({
                exists: false,
                message: 'Email not found'
            });
        }
    } catch (err) {
        console.error('❌ Database error:', err);
        return res.status(500).json({
            exists: false,
            message: 'Database error'
        });
    }
});

// ✅ SEND OTP API
app.post('/api/send-otp', async (req, res) => {
    const { email } = req.body;
    
    console.log('📧 Sending OTP to:', email);

    if (!email) {
        return res.status(400).json({
            success: false,
            message: 'Email is required'
        });
    }

    try {
        const checkEmailQuery = 'SELECT * FROM "user" WHERE email = $1';
        const result = await query(checkEmailQuery, [email]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Email not registered'
            });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const username = result.rows[0].username;
        
        otpStore[email] = {
            otp: otp,
            expires: Date.now() + 5 * 60 * 1000
        };

        console.log('🔐 Generated OTP for', email, ':', otp);

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Password Reset OTP - Smart Museum Jaipur',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #e94560;">Smart Museum Jaipur</h2>
                    <h3>Password Reset Request</h3>
                    <p>Hello ${username},</p>
                    <p>You requested to reset your password. Use the OTP below to verify your identity:</p>
                    <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0;">
                        <h1 style="color: #e94560; font-size: 32px; letter-spacing: 5px; margin: 0;">${otp}</h1>
                    </div>
                    <p>This OTP will expire in 5 minutes.</p>
                    <p>If you didn't request this, please ignore this email.</p>
                    <br>
                    <p>Best regards,<br>Smart Museum Jaipur Team</p>
                </div>
            `
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('❌ Error sending OTP:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to send OTP. Please try again.',
                    error: error.message
                });
            }
            
            console.log('✅ OTP sent successfully to:', email);
            
            res.json({
                success: true,
                message: 'OTP sent successfully to your email',
                
            });
        });
    } catch (err) {
        console.error('❌ Database error:', err);
        return res.status(500).json({
            success: false,
            message: 'Database error'
        });
    }
});

// ✅ VERIFY OTP API
app.post('/api/verify-otp', (req, res) => {
    const { email, otp } = req.body;

    console.log('🔐 Verifying OTP:', { email, otp });

    if (!email || !otp) {
        return res.status(400).json({
            success: false,
            message: 'Email and OTP are required'
        });
    }

    const storedOtpData = otpStore[email];

    if (!storedOtpData) {
        return res.status(400).json({
            success: false,
            message: 'OTP not found or expired'
        });
    }

    if (Date.now() > storedOtpData.expires) {
        delete otpStore[email];
        return res.status(400).json({
            success: false,
            message: 'OTP has expired'
        });
    }

    if (storedOtpData.otp === otp) {
        delete otpStore[email];
        console.log('✅ OTP verified successfully for:', email);
        
        res.json({
            success: true,
            message: 'OTP verified successfully'
        });
    } else {
        res.status(400).json({
            success: false,
            message: 'Invalid OTP'
        });
    }
});

// ✅ RESET PASSWORD API
app.post('/api/reset-password', async (req, res) => {
    const { email, newPassword } = req.body;

    console.log('🔄 Password reset request:', { email });

    if (!email || !newPassword) {
        return res.status(400).json({
            success: false,
            message: 'Email and new password are required'
        });
    }

    try {
        const queryText = 'UPDATE "user" SET password = $1 WHERE email = $2';
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const result = await query(queryText, [hashedPassword, email]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        console.log('✅ Password reset successful for:', email);
        
        res.json({
            success: true,
            message: 'Password reset successfully'
        });
    } catch (err) {
        console.error('❌ Database error:', err);
        return res.status(500).json({
            success: false,
            message: 'Database error'
        });
    }
});

// REGISTER
app.post('/api/register', async (req, res) => {
    console.log('📨 Registration request:', req.body);

    const { username, email, phone_number, gender, age, password } = req.body;

    if (!username || !email || !phone_number || !password) {
        return res.status(400).json({ success: false, message: 'All required fields must be filled!' });
    }

    try {
        const checkEmailQuery = 'SELECT user_id FROM "user" WHERE email = $1';
        const emailResult = await query(checkEmailQuery, [email]);
        
        if (emailResult.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Email already exists!' });
        }

        const checkUsernameQuery = 'SELECT user_id FROM "user" WHERE username = $1';
        const usernameResult = await query(checkUsernameQuery, [username]);
        
        if (usernameResult.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Username already exists!' });
        }

        const genderMap = { male: 'Male', female: 'Female', other: 'Other', 'prefer-not-to-say': 'Other' };
        const dbGender = genderMap[gender] || 'Other';

        const hashedPassword = await bcrypt.hash(password, 10);

        const insertQuery = `
            INSERT INTO "user" (username, email, phone_number, gender, age, password) 
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING user_id
        `;
        

        const insertResult = await query(insertQuery, [username, email, phone_number, dbGender, age || null,  hashedPassword]);
        
        console.log('✅ User registered successfully. ID:', insertResult.rows[0].user_id);
        res.json({ success: true, message: 'Registration successful!', user_id: insertResult.rows[0].user_id, username });
        
    } catch (err) {
        console.error('❌ Registration error:', err);
        return res.status(500).json({ success: false, message: 'Registration failed!', error: err.message });
    }
});

// LOGIN
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('🔐 Login attempt:', { username });

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required!' });
    }

    try {
        const queryText = 'SELECT * FROM "user" WHERE username = $1';
        const result = await query(queryText, [username]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid username or password!' });
        }

        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);

         if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Invalid username or password!' });
}

        const userData = {
            user_id: user.user_id,
            username: user.username,
            email: user.email,
            phone_number: user.phone_number,
            gender: user.gender,
            age: user.age
        };
        
        console.log("✅ Login successful, user_id:", user.user_id);
        res.json({ success: true, message: 'Login successful!', user: userData });
        
    } catch (err) {
        console.error('❌ Login error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
    }
});

// Get logged in user details
app.get("/api/user/:id", async (req, res) => {
    const userId = req.params.id;
    try {
        const sql = "SELECT username, email, phone_number, gender, age FROM \"user\" WHERE user_id = $1";
        const result = await query(sql, [userId]);
        
        if (result.rows.length === 0) {
            return res.send({ success: false });
        }
        res.send({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error('❌ Error:', err);
        res.send({ success: false, error: err.message });
    }
});

// ================= ADMIN LOGIN =================
app.post("/api/admin/login", async (req, res) => {
    const { username, password } = req.body;
    console.log("🔐 Admin login attempt:", username);

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: "Username and password required"
        });
    }

    try {
        const queryText = "SELECT * FROM admin WHERE username = $1";
        const result = await query(queryText, [username]);

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid admin username or password"
            });
        }

        const admin = result.rows[0];

        const isMatch = await bcrypt.compare(password, admin.password);

       if (!isMatch) {
        return res.status(401).json({
        success: false,
        message: "Invalid admin username or password"
    });
}

        console.log("✅ Admin logged in successfully");
        return res.json({
            success: true,
            message: "Signed in successfully",
            admin: {
                username: admin.username,
                email: admin.email
            }
        });
    } catch (err) {
        console.error("❌ DB error:", err);
        return res.status(500).json({
            success: false,
            message: "Database error"
        });
    }
});

// Admin OTP APIs
app.post("/api/admin/send-otp", async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: "Email required" });
    }

    try {
        const result = await query("SELECT * FROM admin WHERE email = $1", [email]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Admin email not registered"
            });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        adminOtpStore[email] = {
            otp,
            expires: Date.now() + 5 * 60 * 1000
        };

        transporter.sendMail({
            to: email,
            subject: "Admin OTP - Smart Museum",
            html: `<h2>Admin Password Reset</h2><h1>${otp}</h1>`
        }, err => {
            if (err) return res.status(500).json({ success: false, message: "Email failed" });
            res.json({ success: true, message: "OTP sent" });
        });
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
        const hashedPassword = await bcrypt.hash(newPassword, 10);

   await query(
    "UPDATE admin SET password = $1 WHERE email = $2",
    [hashedPassword, email]
);
        delete adminOtpStore[email];
        res.json({ success: true, message: "Password reset successful" });
    } catch (err) {
        return res.status(500).json({ success: false });
    }
});

// Museums API
app.get("/api/museums", async (req, res) => {
    const { city, category } = req.query;

    let sql = `
        SELECT 
            id,
            name,
            description,
            open_time,
            close_time,
            main_image,
            city,
            category
        FROM museums
        WHERE 1=1
    `;

    let params = [];
    let paramCounter = 1;

    if (city && city !== "ALL") {
        sql += ` AND city = $${paramCounter}`;
        params.push(city);
        paramCounter++;
    }

    if (category) {
        sql += ` AND category = $${paramCounter}`;
        params.push(category);
        paramCounter++;
    }

    sql += " ORDER BY id ASC";

    console.log("🏛️ Fetch museums:", { city, category });

    try {
        const result = await query(sql, params);
        res.json(result.rows);
    } catch (err) {
        console.error("❌ Museums fetch error:", err);
        return res.status(500).json({
            success: false,
            message: "Database error"
        });
    }
});

// UPDATE PROFILE API
app.put('/api/edit-profile', async (req, res) => {
    console.log('✏️ Update profile request:', req.body);
    const { userId, email, phone_number } = req.body;

    if (!userId) {
        return res.status(400).json({ success: false, message: 'userId is required' });
    }

    try {
        const queryText = 'UPDATE "user" SET email = $1, phone_number = $2 WHERE user_id = $3';
        const result = await query(queryText, [email, phone_number, userId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        console.log('✅ Profile updated for user:', userId);
        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
        console.error('❌ Update error:', err);
        return res.status(500).json({ success: false, message: 'Database error', error: err.message });
    }
});

// ================= ADMIN MUSEUM MANAGEMENT =================
app.get('/api/admin/museum/:id', async (req, res) => {
    const museumId = req.params.id;
    try {
        const result = await query('SELECT * FROM museums WHERE id = $1', [museumId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Museum not found" });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error("❌ Museum fetch error:", err);
        return res.status(500).json({ success: false });
    }
});

app.get('/api/admin/museum/:id/gallery', async (req, res) => {
    const museumId = req.params.id;
    try {
        const result = await query('SELECT * FROM gallery WHERE museum_id = $1', [museumId]);
        res.json(result.rows);
    } catch (err) {
        console.error("❌ Gallery fetch error:", err);
        return res.status(500).json([]);
    }
});

app.get('/api/admin/museum/:id/tickets', async (req, res) => {
    const museumId = req.params.id;
    try {
        const result = await query('SELECT * FROM tickets WHERE museum_id = $1', [museumId]);
        res.json(result.rows);
    } catch (err) {
        console.error("❌ Tickets fetch error:", err);
        return res.status(500).json([]);
    }
});

app.put('/api/admin/museum/:id', async (req, res) => {
    const {
        name,
        description,
        address,
        open_time,
        close_time,
        main_image,
        city,
        category
    } = req.body;

    try {
        const queryText = `
            UPDATE museums 
            SET name=$1, description=$2, address=$3, open_time=$4, close_time=$5, 
                main_image=$6, city=$7, category=$8
            WHERE id=$9
        `;
        await query(queryText, [name, description, address, open_time, close_time, main_image, city, category, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Museum update error:", err);
        return res.status(500).json({ success: false });
    }
});

app.put('/api/admin/gallery/:id', async (req, res) => {
    try {
        await query('UPDATE gallery SET image_url=$1 WHERE id=$2', [req.body.image_url, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false });
    }
});

app.put('/api/admin/ticket/:id', async (req, res) => {
    const { type, price } = req.body;
    try {
        await query('UPDATE tickets SET type=$1, price=$2 WHERE id=$3', [type, price, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false });
    }
});

app.post('/api/admin/gallery', async (req, res) => {
    const { museum_id, image_url } = req.body;
    if (!museum_id || !image_url) {
        return res.status(400).json({ success: false, message: "Missing data" });
    }
    try {
        await query('INSERT INTO gallery (museum_id, image_url) VALUES ($1, $2)', [museum_id, image_url]);
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Gallery insert error:", err);
        return res.status(500).json({ success: false });
    }
});

app.delete('/api/admin/gallery/:id', async (req, res) => {
    try {
        await query('DELETE FROM gallery WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Gallery delete error:", err);
        return res.status(500).json({ success: false });
    }
});

app.post('/api/admin/ticket', async (req, res) => {
    const { museum_id, type, price } = req.body;
    if (!museum_id || !type || !price) {
        return res.status(400).json({ success: false, message: "Missing data" });
    }
    try {
        await query('INSERT INTO tickets (museum_id, type, price) VALUES ($1, $2, $3)', [museum_id, type, price]);
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Ticket insert error:", err);
        return res.status(500).json({ success: false });
    }
});

app.delete('/api/admin/ticket/:id', async (req, res) => {
    try {
        await query('DELETE FROM tickets WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Ticket delete error:", err);
        return res.status(500).json({ success: false });
    }
});

// DELETE MUSEUM
app.delete("/api/museum/:id", async (req, res) => {
    const museumId = req.params.id;
    try {
        const result = await query("DELETE FROM museums WHERE id = $1", [museumId]);
        if (result.rowCount === 0) {
            return res.json({ success: false });
        }
        res.json({ success: true });
    } catch (err) {
        console.log(err);
        return res.status(500).json({ success: false });
    }
});

// CREATE NEW MUSEUM
app.post("/api/admin/museum", async (req, res) => {
    const { name, description, address, open_time, close_time, main_image, city, category } = req.body;
    const sql = `
        INSERT INTO museums
        (name, description, address, open_time, close_time, main_image, city, category)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
    `;
    try {
        const result = await query(sql, [name, description, address, open_time, close_time, main_image, city, category]);
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.log("SQL ERROR:", err);
        return res.status(500).json({ success: false });
    }
});

// PUBLIC MUSEUM APIs
app.get('/api/museum/:id', async (req, res) => {
    const museumId = req.params.id;
    try {
        const result = await query('SELECT * FROM museums WHERE id = $1', [museumId]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).send(err);
    }
});

app.get('/api/museum/:id/tickets', async (req, res) => {
    const museumId = req.params.id;
    try {
        const result = await query('SELECT * FROM tickets WHERE museum_id = $1', [museumId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err);
    }
});

app.get('/api/museum/:id/gallery', async (req, res) => {
    const museumId = req.params.id;
    try {
        const result = await query('SELECT * FROM gallery WHERE museum_id = $1', [museumId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err);
    }
});

// ADMIN USERS API
app.get("/api/admin/users", async (req, res) => {
    const sql = `SELECT user_id, username, email, phone_number, gender, age FROM "user" ORDER BY user_id`;
    try {
        const result = await query(sql);
        res.json({ success: true, users: result.rows });
    } catch (err) {
        console.log("Users fetch error:", err);
        return res.status(500).json({ success: false, message: "Database error" });
    }
});

// ADMIN BOOKINGS LIST - FIXED
app.get("/api/admin/bookings", async (req, res) => {
    try {
        // First, check if there are any bookings
        const countResult = await query("SELECT COUNT(*) as count FROM booking");
        console.log("📊 Total bookings in DB:", countResult.rows[0].count);
        
        // If no bookings, return empty array
        if (parseInt(countResult.rows[0].count) === 0) {
            return res.json({ success: true, bookings: [] });
        }
        
        // Get bookings with museum names - use LEFT JOIN
        const sql = `
            SELECT 
                b.booking_id,
                b.name,
                COALESCE(m.name, 'Unknown Museum') AS museum_name,
                TO_CHAR(b.visit_date, 'YYYY-MM-DD') as visit_date,
                b.num_adults,
                b.num_children,
                b.amount_paid,
                b.payment_status,
                TO_CHAR(b.booking_date, 'YYYY-MM-DD HH24:MI:SS') as booking_date
            FROM booking b
            LEFT JOIN museums m ON b.museum_id = m.id
            ORDER BY b.booking_date DESC
        `;
        
        const result = await query(sql);
        console.log(`✅ Found ${result.rows.length} bookings with museum names`);
        
        // Debug: Log first booking to see if museum_name is there
        if (result.rows.length > 0) {
            console.log("📋 First booking:", {
                id: result.rows[0].booking_id,
                museum_id: result.rows[0].museum_id,
                museum_name: result.rows[0].museum_name
            });
        }
        
        res.json({ success: true, bookings: result.rows });
    } catch (err) {
        console.error("❌ Booking error:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// CREATE CHECKOUT SESSION
app.post("/api/create-checkout-session", async (req, res) => {
    try {
        const { museumName, ticketType, email, visitDate, amount, museumId, userName, userAge, phoneNumber, gender, userId } = req.body;
        
        console.log("📨 Creating checkout session:", {
            email, museumName, museumId, visitDate, amount, userId
        });

        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required" });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{
                price_data: {
                    currency: "inr",
                    product_data: {
                        name: museumName || "Museum Entry Ticket",
                        description: ticketType || "Museum visit ticket"
                    },
                    unit_amount: Math.round(amount * 100),
                },
                quantity: 1,
            }],
            mode: "payment",
            metadata: {
                museumName,
                ticketType,
                email,
                visitDate,
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
        console.log("📦 Metadata userId:", session.metadata.userId);

        res.json({ success: true, url: session.url, sessionId: session.id });

    } catch (error) {
        console.error("❌ Stripe error:", error);
        res.status(500).json({ success: false, message: "Stripe payment failed", error: error.message });
    }
});

// PAYMENT SUCCESS HANDLER
app.get("/api/payment-success", async (req, res) => {
    console.log("\n🔥 PAYMENT SUCCESS API CALLED");
    console.log("Session ID:", req.query.session_id);

    try {
        const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
        
        if (session.payment_status !== "paid") {
            console.log("❌ Payment not completed");
            return res.json({ success: false, error: "Payment not completed" });
        }

        const metadata = session.metadata;
        console.log("📦 Session metadata:", metadata);

        const { museumName, ticketType, email, visitDate, museumId, userName, userAge, phoneNumber, gender, userId } = metadata;

        if (!email) {
            console.log("❌ ERROR: No email in metadata!");
            return res.json({ success: false, error: "Email not found in session" });
        }

        // ✅ FIX: Convert gender to proper case
        let finalGender = "Other";
        if (gender) {
            const genderLower = gender.toLowerCase().trim();
            if (genderLower === 'male' || genderLower === 'm') {
                finalGender = 'Male';
            } else if (genderLower === 'female' || genderLower === 'f') {
                finalGender = 'Female';
            } else if (genderLower === 'other' || genderLower === 'o') {
                finalGender = 'Other';
            }
        }
        console.log("👤 Gender conversion:", { original: gender, converted: finalGender });

        const bookingId = uuidv4().substring(0, 20); 
        
        let adult = 1, child = 0;
        if (ticketType) {
            const numbers = ticketType.match(/\d+/g);
            if (numbers) {
                adult = parseInt(numbers[0]) || 1;
                child = parseInt(numbers[1]) || 0;
            }
        }

        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60 * 1000) + istOffset);

        const year = istTime.getFullYear();
        const month = String(istTime.getMonth() + 1).padStart(2, '0');
        const day = String(istTime.getDate()).padStart(2, '0');
        const hours = String(istTime.getHours()).padStart(2, '0');
        const minutes = String(istTime.getMinutes()).padStart(2, '0');
        const seconds = String(istTime.getSeconds()).padStart(2, '0');

        const bookingDate = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

        console.log("📧 Preparing email for:", email);
        console.log("🎟️ Ticket details:", { bookingId, adult, child, visitDate, userId });

        // Create PDF
        const buffers = [];
        const doc = new PDFDocument();
        
        doc.on("data", buffers.push.bind(buffers));
        
        doc.on("end", async () => {
            const pdfData = Buffer.concat(buffers);
            
            try {
                const mailResult = await transporter.sendMail({
                    from: `"Smart Museum Jaipur" <${process.env.EMAIL_USER}>`,
                    to: email,
                    subject: "Your Museum Ticket - Smart Museum Jaipur 🎟️",
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
                        content: pdfData,
                        contentType: 'application/pdf'
                    }]
                });

                console.log("✅ EMAIL SENT SUCCESSFULLY");
                console.log("   Message ID:", mailResult.messageId);

            } catch (emailError) {
                console.log("❌ EMAIL ERROR:", emailError.message);
                console.log("   Continuing with database save...");
            }

            // Save to PostgreSQL - USE finalGender here
            const sql = `INSERT INTO booking (
                booking_id, name, age, email, phone_number, gender,
                visit_date, num_adults, num_children, amount_paid,
                user_id, museum_id, booking_date, payment_status, stripe_session_id, is_used
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`;

            const values = [
                bookingId,
                userName || "Guest",
                userAge ? parseInt(userAge) : null,
                email,
                phoneNumber || null,
                finalGender,  // ✅ FIX: Use finalGender instead of gender
                visitDate,
                adult,
                child,
                Math.round(session.amount_total / 100),
                userId ? parseInt(userId) : null,
                museumId ? parseInt(museumId) : null,
                bookingDate,
                "PAID",
                session.id,
                false
            ];

            console.log("📦 Saving to database with userId:", userId);
            console.log("📦 Gender being saved:", finalGender);

            try {
                await query(sql, values);
                console.log("✅ Booking saved to database with ID:", bookingId);
                console.log("   User ID saved:", userId);
                
                res.json({ 
                    success: true, 
                    message: "Booking confirmed!",
                    bookingId: bookingId,
                    emailSent: false
                });
            } catch (dbError) {
                console.error("❌ DB Save Error:", dbError);
                return res.json({ 
                    success: false, 
                    error: "Database save failed",
                    details: dbError.message,
                    bookingId: bookingId 
                });
            }
        });

        // Generate PDF content (same as before)
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
            const barcode = await bwipjs.toBuffer({
                bcid: "code128",
                text: bookingId,
                scale: 3,
                height: 10,
                includetext: true
            });
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

// GET BOOKING DETAILS API
app.get("/api/booking/:id", async (req, res) => {
    const bookingId = req.params.id;
    try {
        const result = await query("SELECT * FROM booking WHERE booking_id = $1", [bookingId]);
        res.json(result.rows[0] || {});
    } catch (err) {
        console.error("❌ DB Error:", err);
        return res.status(500).json({ success: false });
    }
});

// USER BOOKING HISTORY
app.get("/api/user/:userId/bookings", async (req, res) => {
    const userId = req.params.userId;

    console.log("📋 Fetching bookings for user ID:", userId);

    if (!userId) {
        return res.status(400).json({ success: false, message: "User ID is required" });
    }

    const sql = `
        SELECT 
            b.booking_id,
            b.name,
            b.visit_date,
            b.num_adults,
            b.num_children,
            b.amount_paid,
            b.payment_status,
            b.museum_id,
            b.booking_date,
            b.is_used,
            m.name as museum_name
        FROM booking b
        LEFT JOIN museums m ON b.museum_id = m.id
        WHERE b.user_id = $1
        ORDER BY b.booking_date DESC
    `;

    try {
        const result = await query(sql, [userId]);
        console.log(`✅ Found ${result.rows.length} bookings for user ${userId}`);
        res.json({ success: true, bookings: result.rows });
    } catch (err) {
        console.error("❌ Database error:", err);
        return res.status(500).json({ success: false, message: "Database error" });
    }
});

// ADMIN DASHBOARD APIs
app.get('/api/admin/stats', async (req, res) => {
    try {
        const museumsResult = await query("SELECT COUNT(*) as count FROM museums");
        const usersResult = await query("SELECT COUNT(*) as count FROM \"user\"");
        const bookingsResult = await query("SELECT COUNT(*) as count FROM booking");
        const revenueResult = await query(
            "SELECT COALESCE(SUM(amount_paid), 0) as total FROM booking WHERE DATE(booking_date) = CURRENT_DATE"
        );
        const totalRevenueResult = await query(
            "SELECT COALESCE(SUM(amount_paid), 0) as total FROM booking"
        );
        const visitorsResult = await query(
            "SELECT COUNT(DISTINCT booking_id) as count FROM booking WHERE DATE(booking_date) = CURRENT_DATE"
        );

        res.json({
            totalMuseums: parseInt(museumsResult.rows[0].count),
            totalUsers: parseInt(usersResult.rows[0].count),
            totalBookings: parseInt(bookingsResult.rows[0].count),
            todayRevenue: parseFloat(revenueResult.rows[0].total),
            totalRevenue: parseFloat(totalRevenueResult.rows[0].total),
            todayVisitors: parseInt(visitorsResult.rows[0].count)
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ADMIN DASHBOARD APIs - FIXED MONTHLY REVENUE
app.get('/api/admin/monthly-revenue', async (req, res) => {
    try {
        console.log("📊 Fetching monthly revenue...");
        
        // Get all bookings grouped by month
        const queryText = `
            SELECT 
                TO_CHAR(booking_date, 'YYYY-MM') as month,
                SUM(amount_paid) as total_revenue
            FROM booking 
            WHERE booking_date IS NOT NULL
            GROUP BY TO_CHAR(booking_date, 'YYYY-MM')
            ORDER BY month ASC
            LIMIT 6
        `;
        
        const result = await query(queryText);
        console.log("Monthly revenue query result:", result.rows);
        
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        const months = [];
        const revenues = [];
        
        result.rows.forEach(row => {
            const [year, month] = row.month.split('-');
            const monthName = monthNames[parseInt(month) - 1];
            months.push(`${monthName} ${year}`);
            revenues.push(parseFloat(row.total_revenue));
            console.log(`Month: ${monthName} ${year}, Revenue: ${row.total_revenue}`);
        });
        
        // If no data, send sample data for testing
        if (months.length === 0) {
            console.log("No revenue data found, sending sample data");
            res.json({
                months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                revenues: [1250, 2340, 1890, 3120, 2780, 4120]
            });
        } else {
            res.json({
                months: months,
                revenues: revenues
            });
        }
        
    } catch (error) {
        console.error('Revenue fetch error:', error);
        // Send fallback data on error
        res.json({
            months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            revenues: [0, 0, 0, 0, 0, 0]
        });
    }
});

// Get popular museums - FIXED
app.get('/api/admin/popular-museums', async (req, res) => {
    try {
        const queryText = `
            SELECT 
                COALESCE(m.name, 'Unknown Museum') as name, 
                COUNT(b.booking_id) as "bookingCount"
            FROM museums m
            LEFT JOIN booking b ON m.id = b.museum_id
            GROUP BY m.id, m.name
            ORDER BY "bookingCount" DESC
            LIMIT 5
        `;
        
        const result = await query(queryText);
        console.log("🏆 Popular museums:", result.rows);
        res.json(result.rows);
    } catch (error) {
        console.error('Popular museums error:', error);
        res.status(500).json({ error: error.message });
    }
});
// Get recent bookings - FIXED
app.get('/api/admin/recent-bookings', async (req, res) => {
    try {
        const queryText = `
            SELECT 
                b.booking_id as id,
                COALESCE(b.name, 'Guest') as userName,
                COALESCE(m.name, 'Museum ID: ' || b.museum_id) as museumName,
                TO_CHAR(b.booking_date, 'YYYY-MM-DD HH24:MI:SS') as bookingDate,
                TO_CHAR(b.visit_date, 'YYYY-MM-DD') as visitDate,
                b.amount_paid as amount,
                b.payment_status as status
            FROM booking b
            LEFT JOIN museums m ON b.museum_id = m.id
            ORDER BY b.booking_date DESC
            LIMIT 10
        `;
        
        const result = await query(queryText);
        console.log(`📋 Found ${result.rows.length} recent bookings`);
        
        // Log first booking to debug
        if (result.rows.length > 0) {
            console.log("📋 First recent booking:", result.rows[0]);
        }
        
        res.json(result.rows);
    } catch (error) {
        console.error('Recent bookings error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(process.env.PORT || 5000, () => {
    console.log(`🚀 Server running on http://localhost:${process.env.PORT || 5000}`);
    console.log(`📋 Test endpoint: http://localhost:${process.env.PORT || 5000}/api/test`);
    console.log(`🗄️  Database test: http://localhost:${process.env.PORT || 5000}/api/test-db`);
    console.log(`📧 OTP APIs: /api/send-otp, /api/verify-otp, /api/reset-password`);
    console.log(`🔗 Connected to Supabase PostgreSQL`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
