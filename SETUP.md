# RS on the Go — Review System Setup Guide

## Files included
| File               | What it does                                      |
|--------------------|---------------------------------------------------|
| reviews.html       | Public review page (form + approved reviews)      |
| submit_review.php  | Receives form, saves to DB, emails you            |
| get_reviews.php    | Returns approved reviews as JSON                  |
| admin.php          | Your private moderation panel                     |
| db_setup.sql       | Creates the database table (run once)             |

---

## Step 1 — Create the database table
1. Log into cPanel on your host
2. Open **phpMyAdmin**
3. Click your database name on the left
4. Click the **SQL** tab at the top
5. Paste the contents of `db_setup.sql`
6. Click **Go**

---

## Step 2 — Fill in your config
Open these three PHP files and update the config block at the top of each:

**submit_review.php, get_reviews.php, admin.php:**
```php
define('DB_HOST', 'localhost');         // usually stays as localhost
define('DB_NAME', 'your_db_name');      // from cPanel > MySQL Databases
define('DB_USER', 'your_db_user');      // same
define('DB_PASS', 'your_db_password');  // same
```

**submit_review.php only — email settings:**
```php
define('NOTIFY_EMAIL', 'ronthego586@gmail.com');  // where to send alerts
define('SMTP_USER',    'ronthego586@gmail.com');
define('SMTP_PASS',    'xxxx xxxx xxxx xxxx');     // Gmail App Password (see below)
define('ADMIN_URL',    'https://rsonthegollc.com/admin.php');
```

**admin.php only — your login password:**
```php
define('ADMIN_PASSWORD', 'changeme123');  // pick something strong!
```

---

## Step 3 — Set up Gmail App Password (for email notifications)
1. Go to https://myaccount.google.com/security
2. Make sure **2-Step Verification** is ON
3. Search for **"App passwords"** in the search bar
4. Create one → choose "Mail" → copy the 16-character code
5. Paste that code as `SMTP_PASS` in submit_review.php

---

## Step 4 — Install PHPMailer
1. Download from: https://github.com/PHPMailer/PHPMailer/archive/refs/heads/master.zip
2. Unzip it
3. Rename the folder to **`PHPMailer`** (exactly this name)
4. Upload the whole folder to the same directory as submit_review.php

---

## Step 5 — Upload all files
Upload to your server's public folder (usually `public_html`):
- reviews.html
- submit_review.php
- get_reviews.php
- admin.php
- PHPMailer/ (folder)

---

## How to use it
- **Customers visit:** `yoursite.com/reviews.html` to leave a review
- **You get an email** with the review details and a link to your admin panel
- **You visit:** `yoursite.com/admin.php` — enter your password — approve or reject

---

## Adding the reviews link to your main site
In your main `index.html` navigation, add:
```html
<a href="reviews.html">Reviews</a>
```
