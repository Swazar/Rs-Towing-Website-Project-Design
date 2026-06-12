-- db_setup.sql
-- Run this once in your database to create the reviews table.
-- In cPanel: go to phpMyAdmin → select your database → click SQL tab → paste this → click Go

CREATE TABLE IF NOT EXISTS reviews (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    first_name   VARCHAR(60)   NOT NULL,
    last_name    VARCHAR(60)   NOT NULL,
    email        VARCHAR(150)  NOT NULL,
    service      VARCHAR(100)  NOT NULL,
    rating       TINYINT       NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_text  TEXT          NOT NULL,
    status       ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    submitted_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_submitted (submitted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
