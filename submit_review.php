<?php
/**
 * submit_review.php
 * Receives review form, saves to database, sends email notification.
 *
 * SETUP INSTRUCTIONS:
 * 1. Upload this file to your server alongside reviews.html
 * 2. Create the database table using db_setup.sql
 * 3. Fill in your DB credentials and email below in the CONFIG section
 * 4. Upload PHPMailer (see instructions at bottom of this file)
 */

// ─────────────────────────────────────────
//  CONFIG — edit these values
// ─────────────────────────────────────────
define('DB_HOST', 'localhost');
define('DB_NAME', 'your_database_name');   // <-- change this
define('DB_USER', 'your_db_username');     // <-- change this
define('DB_PASS', 'your_db_password');     // <-- change this

define('NOTIFY_EMAIL', 'ronthego586@gmail.com'); // your email
define('SITE_NAME',    'RS on the Go LLC');
define('ADMIN_URL',    'https://rsonthegollc.com/admin.php'); // link in the email

// SMTP (for sending email — use Gmail app password or your host's SMTP)
define('SMTP_HOST',   'smtp.gmail.com');
define('SMTP_PORT',   587);
define('SMTP_USER',   'ronthego586@gmail.com'); // <-- change this
define('SMTP_PASS',   'your_app_password');     // <-- Gmail App Password (not your real password)
// ─────────────────────────────────────────

// Only accept POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit('Method not allowed');
}

// ── Sanitize & validate input ──────────────────────────────────────────────
function clean(string $val): string {
    return htmlspecialchars(strip_tags(trim($val)), ENT_QUOTES, 'UTF-8');
}

$first_name  = clean($_POST['first_name']  ?? '');
$last_name   = clean($_POST['last_name']   ?? '');
$email       = filter_var(trim($_POST['email'] ?? ''), FILTER_SANITIZE_EMAIL);
$service     = clean($_POST['service']     ?? '');
$rating      = intval($_POST['rating']     ?? 0);
$review_text = clean($_POST['review_text'] ?? '');

// Validate
$errors = [];
if (empty($first_name))              $errors[] = 'First name is required.';
if (empty($last_name))               $errors[] = 'Last name is required.';
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $errors[] = 'Valid email is required.';
if (empty($service))                 $errors[] = 'Please select a service.';
if ($rating < 1 || $rating > 5)     $errors[] = 'Rating must be between 1 and 5.';
if (strlen($review_text) < 10)      $errors[] = 'Review must be at least 10 characters.';
if (strlen($review_text) > 2000)    $errors[] = 'Review must be under 2000 characters.';

if (!empty($errors)) {
    http_response_code(400);
    exit(implode(' ', $errors));
}

// ── Save to database ───────────────────────────────────────────────────────
try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );

    $stmt = $pdo->prepare("
        INSERT INTO reviews (first_name, last_name, email, service, rating, review_text, status, submitted_at)
        VALUES (:first_name, :last_name, :email, :service, :rating, :review_text, 'pending', NOW())
    ");

    $stmt->execute([
        ':first_name'  => $first_name,
        ':last_name'   => $last_name,
        ':email'       => $email,
        ':service'     => $service,
        ':rating'      => $rating,
        ':review_text' => $review_text,
    ]);

    $review_id = $pdo->lastInsertId();

} catch (PDOException $e) {
    http_response_code(500);
    // Log the real error server-side, never show it to the user
    error_log('DB error in submit_review.php: ' . $e->getMessage());
    exit('Database error. Please try again.');
}

// ── Send email notification ────────────────────────────────────────────────
// Uses PHPMailer. If you don't have it, see installation note at bottom.
$emailSent = false;

if (file_exists(__DIR__ . '/PHPMailer/src/PHPMailer.php')) {
    require __DIR__ . '/PHPMailer/src/Exception.php';
    require __DIR__ . '/PHPMailer/src/PHPMailer.php';
    require __DIR__ . '/PHPMailer/src/SMTP.php';

    $stars = str_repeat('★', $rating) . str_repeat('☆', 5 - $rating);

    $mail = new PHPMailer\PHPMailer\PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host       = SMTP_HOST;
        $mail->SMTPAuth   = true;
        $mail->Username   = SMTP_USER;
        $mail->Password   = SMTP_PASS;
        $mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port       = SMTP_PORT;

        $mail->setFrom(SMTP_USER, SITE_NAME . ' Reviews');
        $mail->addAddress(NOTIFY_EMAIL);
        $mail->Subject = '⭐ New Review Pending Approval — ' . SITE_NAME;
        $mail->isHTML(true);
        $mail->Body = "
            <div style='font-family:sans-serif;max-width:560px;margin:auto;background:#0d1117;color:#e6edf3;padding:32px;border-radius:10px;'>
              <h2 style='color:#e07b39;margin-top:0;'>New Review Submitted</h2>
              <table style='width:100%;border-collapse:collapse;font-size:14px;'>
                <tr><td style='padding:6px 0;color:#8b949e;width:120px;'>Name</td><td style='padding:6px 0;'>{$first_name} {$last_name}</td></tr>
                <tr><td style='padding:6px 0;color:#8b949e;'>Email</td><td style='padding:6px 0;'>{$email}</td></tr>
                <tr><td style='padding:6px 0;color:#8b949e;'>Service</td><td style='padding:6px 0;'>{$service}</td></tr>
                <tr><td style='padding:6px 0;color:#8b949e;'>Rating</td><td style='padding:6px 0;color:#f5a623;'>{$stars}</td></tr>
              </table>
              <div style='background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin:20px 0;font-size:14px;line-height:1.6;'>
                {$review_text}
              </div>
              <a href='" . ADMIN_URL . "' style='display:inline-block;background:#e07b39;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;font-size:14px;'>
                Review in Admin Panel →
              </a>
              <p style='color:#8b949e;font-size:12px;margin-top:20px;'>Review ID #{$review_id}</p>
            </div>
        ";
        $mail->AltBody = "New review from {$first_name} {$last_name}\nService: {$service}\nRating: {$rating}/5\n\n{$review_text}\n\nApprove/reject: " . ADMIN_URL;

        $mail->send();
        $emailSent = true;
    } catch (Exception $e) {
        error_log('Mailer error: ' . $mail->ErrorInfo);
    }
} else {
    // PHPMailer not found — log it but don't fail the submission
    error_log('PHPMailer not found. Review saved but email not sent. Review ID: ' . $review_id);
}

// ── Respond ────────────────────────────────────────────────────────────────
echo 'success';

/*
 ┌─────────────────────────────────────────────────────────┐
 │  PHPMAILER INSTALLATION                                  │
 │                                                          │
 │  Option 1 (easiest): Download from GitHub               │
 │  https://github.com/PHPMailer/PHPMailer                  │
 │  Unzip → rename folder to "PHPMailer" → upload to        │
 │  same folder as this file.                               │
 │                                                          │
 │  Option 2 (if you have Composer):                        │
 │  composer require phpmailer/phpmailer                    │
 │                                                          │
 │  GMAIL APP PASSWORD SETUP:                               │
 │  1. Go to myaccount.google.com/security                  │
 │  2. Enable 2-Step Verification                           │
 │  3. Search "App passwords" → create one for "Mail"       │
 │  4. Use that 16-character code as SMTP_PASS above        │
 └─────────────────────────────────────────────────────────┘
*/
