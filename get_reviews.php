<?php
/**
 * get_reviews.php
 * Returns approved reviews as JSON.
 * Called by reviews.html via JavaScript to display reviews.
 *
 * SETUP: Fill in the same DB credentials as submit_review.php
 */

define('DB_HOST', 'localhost');
define('DB_NAME', 'your_database_name');
define('DB_USER', 'your_db_username');
define('DB_PASS', 'your_db_password');

header('Content-Type: application/json');

try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER,
        DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );

    $reviews = $pdo->query("
        SELECT first_name, last_name, service, rating, review_text, submitted_at
        FROM reviews
        WHERE status = 'approved'
        ORDER BY submitted_at DESC
        LIMIT 20
    ")->fetchAll();

    // Format date before sending
    foreach ($reviews as &$r) {
        $r['date'] = date('F j, Y', strtotime($r['submitted_at']));
        unset($r['submitted_at']);
    }

    echo json_encode(['success' => true, 'reviews' => $reviews]);

} catch (PDOException $e) {
    error_log('get_reviews.php error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'reviews' => []]);
}
