<?php
/**
 * admin.php
 * Private page to approve / reject submitted reviews.
 *
 * SETUP:
 * 1. Change ADMIN_PASSWORD below to something only you know
 * 2. Fill in the same DB credentials as submit_review.php
 * 3. Upload to your server — access at yoursite.com/admin.php
 */

// ─────────────────────────────────────────
//  CONFIG — edit these values
// ─────────────────────────────────────────
define('ADMIN_PASSWORD', 'changeme123');   // <-- pick a strong password

define('DB_HOST', 'localhost');
define('DB_NAME', 'your_database_name');   // <-- same as submit_review.php
define('DB_USER', 'your_db_username');
define('DB_PASS', 'your_db_password');
// ─────────────────────────────────────────

session_start();

// ── Auth ───────────────────────────────────────────────────────────────────
$loginError = '';

if (isset($_POST['logout'])) {
    session_destroy();
    header('Location: admin.php');
    exit;
}

if (isset($_POST['password'])) {
    if ($_POST['password'] === ADMIN_PASSWORD) {
        $_SESSION['admin_auth'] = true;
    } else {
        $loginError = 'Incorrect password.';
    }
}

$authed = !empty($_SESSION['admin_auth']);

// ── DB connection (only when authed) ──────────────────────────────────────
$pdo = null;
if ($authed) {
    try {
        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
            DB_USER,
            DB_PASS,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
        );
    } catch (PDOException $e) {
        error_log('Admin DB error: ' . $e->getMessage());
        die('Database connection failed.');
    }
}

// ── Handle approve / reject / delete actions ──────────────────────────────
$actionMsg = '';
if ($authed && $pdo && isset($_POST['action'], $_POST['review_id'])) {
    $id     = intval($_POST['review_id']);
    $action = $_POST['action'];

    if ($action === 'approve') {
        $pdo->prepare("UPDATE reviews SET status='approved' WHERE id=?")->execute([$id]);
        $actionMsg = "✓ Review #{$id} approved and now visible on the site.";
    } elseif ($action === 'reject') {
        $pdo->prepare("UPDATE reviews SET status='rejected' WHERE id=?")->execute([$id]);
        $actionMsg = "✗ Review #{$id} rejected.";
    } elseif ($action === 'delete') {
        $pdo->prepare("DELETE FROM reviews WHERE id=?")->execute([$id]);
        $actionMsg = "🗑 Review #{$id} permanently deleted.";
    }
}

// ── Fetch reviews ──────────────────────────────────────────────────────────
$filter     = $_GET['filter'] ?? 'pending';
$validFilters = ['pending', 'approved', 'rejected', 'all'];
if (!in_array($filter, $validFilters)) $filter = 'pending';

$reviews = [];
$counts  = ['pending' => 0, 'approved' => 0, 'rejected' => 0, 'all' => 0];

if ($authed && $pdo) {
    // Get counts
    foreach ($pdo->query("SELECT status, COUNT(*) as n FROM reviews GROUP BY status") as $row) {
        $counts[$row['status']] = (int)$row['n'];
    }
    $counts['all'] = array_sum(array_filter($counts, fn($k) => $k !== 'all', ARRAY_FILTER_USE_KEY));

    // Get reviews
    $where = $filter === 'all' ? '' : "WHERE status = '{$filter}'";
    $reviews = $pdo->query("SELECT * FROM reviews {$where} ORDER BY submitted_at DESC")->fetchAll();
}

function starsHtml(int $n): string {
    return str_repeat('<span class="star filled">★</span>', $n)
         . str_repeat('<span class="star empty">★</span>', 5 - $n);
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Admin – Reviews | RS on the Go</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:        #0d1117;
      --surface:   #161b22;
      --border:    #30363d;
      --accent:    #e07b39;
      --accent-dk: #c46a2a;
      --text:      #e6edf3;
      --muted:     #8b949e;
      --star:      #f5a623;
      --green:     #3fb950;
      --red:       #f85149;
      --yellow:    #d29922;
    }

    body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; min-height: 100vh; }

    /* ── LOGIN PAGE ── */
    .login-wrap {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .login-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 40px;
      width: 100%;
      max-width: 380px;
    }
    .login-card h1 { font-size: 1.3rem; margin-bottom: 6px; }
    .login-card h1 span { color: var(--accent); }
    .login-card p  { color: var(--muted); font-size: 0.85rem; margin-bottom: 28px; }
    .login-card label { display: block; font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 6px; }
    .login-card input[type=password] {
      width: 100%; background: var(--bg); border: 1px solid var(--border);
      border-radius: 6px; color: var(--text); font-family: 'Inter', sans-serif;
      font-size: 0.9rem; padding: 10px 14px; outline: none; margin-bottom: 16px;
      transition: border-color 0.2s;
    }
    .login-card input[type=password]:focus { border-color: var(--accent); }
    .login-card button {
      width: 100%; background: var(--accent); color: #fff; border: none;
      border-radius: 6px; font-family: 'Inter', sans-serif; font-size: 0.9rem;
      font-weight: 600; padding: 11px; cursor: pointer; transition: background 0.2s;
    }
    .login-card button:hover { background: var(--accent-dk); }
    .login-error { background: #3a1a1a; border: 1px solid var(--red); color: var(--red); border-radius: 6px; padding: 10px 14px; font-size: 0.85rem; margin-bottom: 16px; }

    /* ── ADMIN SHELL ── */
    nav {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 60px;
    }
    .nav-brand { font-weight: 700; font-size: 0.95rem; }
    .nav-brand span { color: var(--accent); }
    .nav-right { display: flex; align-items: center; gap: 12px; }
    .nav-right a { color: var(--muted); font-size: 0.82rem; text-decoration: none; }
    .nav-right a:hover { color: var(--text); }
    .logout-btn {
      background: transparent; border: 1px solid var(--border); color: var(--muted);
      border-radius: 6px; font-family: 'Inter', sans-serif; font-size: 0.8rem;
      padding: 6px 14px; cursor: pointer; transition: all 0.2s;
    }
    .logout-btn:hover { border-color: var(--red); color: var(--red); }

    .main { max-width: 960px; margin: 0 auto; padding: 40px 2rem; }

    /* Action banner */
    .action-banner {
      background: #1a2e1a; border: 1px solid var(--green); color: var(--green);
      border-radius: 8px; padding: 12px 16px; font-size: 0.87rem;
      margin-bottom: 24px; font-weight: 500;
    }

    /* Filter tabs */
    .filter-tabs { display: flex; gap: 6px; margin-bottom: 28px; flex-wrap: wrap; }
    .tab {
      background: var(--surface); border: 1px solid var(--border); color: var(--muted);
      border-radius: 6px; font-family: 'Inter', sans-serif; font-size: 0.82rem;
      font-weight: 600; padding: 7px 16px; cursor: pointer; text-decoration: none;
      transition: all 0.2s;
    }
    .tab:hover { border-color: var(--accent); color: var(--text); }
    .tab.active { background: var(--accent); border-color: var(--accent); color: #fff; }
    .tab .count { opacity: 0.75; margin-left: 4px; }

    /* Review cards */
    .reviews-list { display: flex; flex-direction: column; gap: 16px; }

    .review-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 22px;
    }
    .review-card.pending  { border-left: 3px solid var(--yellow); }
    .review-card.approved { border-left: 3px solid var(--green); }
    .review-card.rejected { border-left: 3px solid var(--red); opacity: 0.7; }

    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .reviewer-info h3 { font-size: 0.95rem; font-weight: 600; }
    .reviewer-meta { font-size: 0.78rem; color: var(--muted); margin-top: 3px; }

    .status-badge {
      font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; padding: 4px 10px; border-radius: 20px;
      white-space: nowrap;
    }
    .status-badge.pending  { background: #2d2206; color: var(--yellow); border: 1px solid var(--yellow); }
    .status-badge.approved { background: #122112; color: var(--green);  border: 1px solid var(--green); }
    .status-badge.rejected { background: #2d1212; color: var(--red);    border: 1px solid var(--red); }

    .star.filled { color: var(--star); }
    .star.empty  { color: var(--border); }
    .stars-row   { font-size: 0.9rem; letter-spacing: 2px; margin-bottom: 10px; }

    .review-text {
      color: var(--muted); font-size: 0.88rem; line-height: 1.65;
      border-left: 2px solid var(--border); padding-left: 12px; margin-bottom: 16px;
    }

    /* Action buttons */
    .card-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn {
      border: none; border-radius: 6px; font-family: 'Inter', sans-serif;
      font-size: 0.8rem; font-weight: 600; padding: 7px 16px; cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.85; }
    .btn-approve { background: var(--green); color: #0d1117; }
    .btn-reject  { background: #2d1212; color: var(--red); border: 1px solid var(--red); }
    .btn-delete  { background: transparent; color: var(--muted); border: 1px solid var(--border); }
    .btn-delete:hover { color: var(--red); border-color: var(--red); opacity: 1; }

    .empty-state {
      text-align: center; padding: 60px 20px; color: var(--muted);
      background: var(--surface); border: 1px dashed var(--border); border-radius: 10px;
    }
  </style>
</head>
<body>

<?php if (!$authed): ?>
<!-- ── LOGIN ── -->
<div class="login-wrap">
  <div class="login-card">
    <h1><span>RS</span> on the Go — Admin</h1>
    <p>Review moderation panel. Enter your password to continue.</p>
    <?php if ($loginError): ?>
      <div class="login-error"><?= $loginError ?></div>
    <?php endif; ?>
    <form method="POST">
      <label>Password</label>
      <input type="password" name="password" autofocus placeholder="Enter admin password" />
      <button type="submit">Log In</button>
    </form>
  </div>
</div>

<?php else: ?>
<!-- ── ADMIN PANEL ── -->
<nav>
  <div class="nav-brand"><span>RS</span> on the Go — Reviews Admin</div>
  <div class="nav-right">
    <a href="reviews.html" target="_blank">View Live Page ↗</a>
    <form method="POST" style="margin:0;">
      <button class="logout-btn" name="logout" value="1">Log Out</button>
    </form>
  </div>
</nav>

<div class="main">

  <?php if ($actionMsg): ?>
    <div class="action-banner"><?= $actionMsg ?></div>
  <?php endif; ?>

  <!-- Filter tabs -->
  <div class="filter-tabs">
    <a href="?filter=pending"  class="tab <?= $filter==='pending'  ? 'active' : '' ?>">Pending  <span class="count">(<?= $counts['pending'] ?>)</span></a>
    <a href="?filter=approved" class="tab <?= $filter==='approved' ? 'active' : '' ?>">Approved <span class="count">(<?= $counts['approved'] ?>)</span></a>
    <a href="?filter=rejected" class="tab <?= $filter==='rejected' ? 'active' : '' ?>">Rejected <span class="count">(<?= $counts['rejected'] ?>)</span></a>
    <a href="?filter=all"      class="tab <?= $filter==='all'      ? 'active' : '' ?>">All      <span class="count">(<?= $counts['all'] ?>)</span></a>
  </div>

  <!-- Reviews -->
  <div class="reviews-list">
    <?php if (empty($reviews)): ?>
      <div class="empty-state">No <?= $filter === 'all' ? '' : $filter ?> reviews found.</div>
    <?php else: foreach ($reviews as $r): ?>
      <div class="review-card <?= $r['status'] ?>">
        <div class="card-top">
          <div class="reviewer-info">
            <h3><?= $r['first_name'] ?> <?= $r['last_name'] ?></h3>
            <div class="reviewer-meta"><?= $r['email'] ?> · <?= $r['service'] ?> · <?= date('M j, Y g:ia', strtotime($r['submitted_at'])) ?></div>
          </div>
          <span class="status-badge <?= $r['status'] ?>"><?= $r['status'] ?></span>
        </div>

        <div class="stars-row"><?= starsHtml((int)$r['rating']) ?></div>
        <div class="review-text"><?= $r['review_text'] ?></div>

        <div class="card-actions">
          <?php if ($r['status'] !== 'approved'): ?>
            <form method="POST" style="margin:0;">
              <input type="hidden" name="review_id" value="<?= $r['id'] ?>">
              <input type="hidden" name="action" value="approve">
              <button class="btn btn-approve" type="submit">✓ Approve</button>
            </form>
          <?php endif; ?>
          <?php if ($r['status'] !== 'rejected'): ?>
            <form method="POST" style="margin:0;">
              <input type="hidden" name="review_id" value="<?= $r['id'] ?>">
              <input type="hidden" name="action" value="reject">
              <button class="btn btn-reject" type="submit">✗ Reject</button>
            </form>
          <?php endif; ?>
          <form method="POST" style="margin:0;" onsubmit="return confirm('Permanently delete this review?')">
            <input type="hidden" name="review_id" value="<?= $r['id'] ?>">
            <input type="hidden" name="action" value="delete">
            <button class="btn btn-delete" type="submit">🗑 Delete</button>
          </form>
        </div>
      </div>
    <?php endforeach; endif; ?>
  </div>

</div>
<?php endif; ?>

</body>
</html>
