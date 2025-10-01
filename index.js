// This will catch any unhandled promise rejections and log them
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config({ path: '.env' });

const app = express();
const port = process.env.PORT || 5000;

// Get credentials from .env
const DB_HOST = process.env.HOST || process.env.MYSQL_HOST; 
const DB_USER = process.env.USER || process.env.MYSQL_USER;
const DB_PASSWORD = process.env.PASSWORD || process.env.MYSQL_PASSWORD;
const DB_DATABASE = process.env.DATABASE || process.env.MYSQL_DATABASE;

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// Connect to MySQL database
let pool;
async function startServer() {
    try {
        pool = mysql.createPool({
            host: MYSQL_HOST,
            user: MYSQL_USER,
            password: MYSQL_PASSWORD,
            database: MYSQL_DATABASE,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
        });

        // Check the connection by executing a simple query
        await pool.getConnection();
        console.log('✅ MySQL connected successfully!');

        // Middleware
        app.use(bodyParser.json());
        app.use(cors());

        // Admin credentials (for simplicity)
        const adminUser = {
            username: 'admin',
            password: 'admin_password',
        };

        // Authentication Middleware
        const auth = (req, res, next) => {
            try {
                const token = req.headers.authorization.split(' ')[1];
                const decoded = jwt.verify(token, JWT_SECRET);
                req.userData = decoded;
                next();
            } catch (error) {
                return res.status(401).json({ message: 'Authentication failed!' });
            }
        };

        const sendSubmissionEmail = async (submission) => {
            const mailOptions = {
                from: `"New Submission" <${process.env.EMAIL_USER}>`,
                to: ADMIN_EMAIL,
                subject: `New Form Submission: ${String(submission.service)}`,
                html: `
                    <h2>New Contact Form Submission</h2>
                    <p><strong>Name:</strong> ${String(submission.name)}</p>
                    <p><strong>Contact Number:</strong> ${String(submission.contact_number)}</p>
                    <p><strong>Service:</strong> ${String(submission.service)}</p>
                    <p><strong>Description:</strong> ${String(submission.description)}</p>
                    <p><strong>Submission Date:</strong> ${String(submission.created_at)}</p>
                `,
            };

            const transporter = nodemailer.createTransport({
                host: 'smtp.gmail.com',
                port: 465,
                secure: true,
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS,
                },
            });

            try {
                await transporter.sendMail(mailOptions);
                console.log('Email sent successfully!');
            } catch (error) {
                console.error('Error sending email:', error);
                throw new Error('Failed to send email');
            }
        };

        // Routes
        app.post('/api/form', async (req, res) => {
            console.log('Received a POST request to /api/form');
            try {
                const { fullName, contactNumber, serviceType, projectDescription } = req.body;
                const submissionData = [fullName, contactNumber, serviceType, projectDescription, new Date()];
                const query = 'INSERT INTO submissions (name, contact_number, service, description, created_at) VALUES (?, ?, ?, ?, ?)';

                await pool.execute(query, submissionData);

                console.log('✅ Form data saved to database successfully!');

                // Now try to send the email, but don't fail the request if it fails
                try {
                    const emailData = {
                      name: fullName,
                      contact_number: contactNumber,
                      service: serviceType,
                      description: projectDescription,
                      created_at: new Date(),
                    };
                    await sendSubmissionEmail(emailData);
                    console.log('✅ Email notification sent!');
                } catch (emailError) {
                    console.error('❌ Failed to send email notification:', emailError);
                }

                res.status(200).json({ message: 'Form submitted successfully!' });
            } catch (error) {
                console.error('❌ Submission error:', error);
                res.status(500).json({ message: 'Error submitting form. Please try again.' });
            }
        });

        app.post('/api/admin/login', async (req, res) => {
            try {
                const { username, password } = req.body;
                if (username === adminUser.username && password === adminUser.password) {
                    const token = jwt.sign({ username: adminUser.username }, JWT_SECRET, { expiresIn: '1h' });
                    return res.status(200).json({ token });
                }
                res.status(401).json({ message: 'Invalid credentials' });
            } catch (error) {
                res.status(500).json({ message: 'Login failed' });
            }
        });

        app.get('/api/forms', auth, async (req, res) => {
            try {
                const query = 'SELECT * FROM submissions ORDER BY created_at DESC';
                const [rows] = await pool.execute(query);
                res.status(200).json(rows);
            } catch (error) {
                console.error('❌ Failed to fetch submissions:', error);
                res.status(500).json({ message: 'Failed to fetch submissions' });
            }
        });

        app.post('/api/forms/:id/resend', auth, async (req, res) => {
            try {
                const query = 'SELECT * FROM submissions WHERE Id = ?';
                const [rows] = await pool.execute(query, [req.params.id]);
                const submission = rows[0];

                if (!submission) {
                    return res.status(404).json({ message: 'Submission not found' });
                }

                const emailData = {
                    name: submission.name,
                    contact_number: submission.contact_number,
                    service: submission.service,
                    description: submission.description,
                    created_at: new Date(submission.created_at).toLocaleString(),
                };

                await sendSubmissionEmail(emailData);

                res.status(200).json({ message: 'Email resent successfully!' });
            } catch (error) {
                console.error('❌ Failed to resend email:', error);
                res.status(500).json({ message: 'Failed to resend email' });
            }
        });

        app.listen(port, () => {
            console.log(`Server is running on http://localhost:${port}`);
        });

    } catch (error) {
        console.error('❌ Failed to connect to MySQL:', error);
        process.exit(1);
    }
}

startServer();
