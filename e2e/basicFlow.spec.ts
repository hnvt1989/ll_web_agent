import { test, expect, Page } from '@playwright/test';
import { execSync } from 'child_process';

// --- Test Configuration ---
const UI_URL = process.env.UI_URL || 'http://localhost:3000'; // Assuming default React port
const DOCKER_COMPOSE_CMD = 'docker-compose'; // Adjust if using a different command or file
const STARTUP_TIMEOUT = 60000; // 60 seconds timeout for services to start
const TEST_TIMEOUT = 90000; // Give the test itself ample time

// --- Helper Functions ---
const runCommand = (command: string) => {
  try {
    console.log(`Executing: ${command}`);
    // Increase timeout for potentially long-running Docker commands
    execSync(command, { stdio: 'inherit', timeout: STARTUP_TIMEOUT });
  } catch (error) {
    console.error(`Error executing command "${command}":`, error);
    throw new Error(`Failed to execute command: ${command}`);
  }
};

// --- Test Suite Setup ---
test.describe('Basic End-to-End Flow', () => {
  // Use test.beforeAll to manage Docker containers
  test.beforeAll(async () => {
    console.log('Starting services using Docker Compose...');
    // Ensure clean state before starting
    runCommand(`${DOCKER_COMPOSE_CMD} down --remove-orphans`);
    // Start services in detached mode
    runCommand(`${DOCKER_COMPOSE_CMD} up --build -d`); // Added --build flag

    // Basic wait: Check if the UI URL is responding.
    // More robust checks might involve polling specific health endpoints if available.
    const startTime = Date.now();
    let connected = false;
    while (Date.now() - startTime < STARTUP_TIMEOUT) {
        try {
            const response = await fetch(UI_URL);
            if (response.ok) {
                console.log('UI service appears to be up.');
                connected = true;
                break;
            }
        } catch (error) {
            // Ignore fetch errors while waiting
        }
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retrying
    }
    if (!connected) {
        throw new Error(`UI service at ${UI_URL} did not become available within ${STARTUP_TIMEOUT / 1000} seconds.`);
    }
    console.log('Services started.');
  });

  // Use test.afterAll to clean up Docker containers
  test.afterAll(() => {
    console.log('Stopping services using Docker Compose...');
    runCommand(`${DOCKER_COMPOSE_CMD} down --remove-orphans`);
    console.log('Services stopped.');
  });

  // --- Test Case ---
  test('should navigate to example.com', async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT); // Set timeout for this specific test

    await page.goto(UI_URL);

    // 1. Enter instruction
    //    (Update selector if needed)
    const instructionInput = page.locator('#instruction-input'); // Placeholder selector
    await instructionInput.waitFor({ state: 'visible', timeout: 10000 });
    await instructionInput.fill('go to example.com');
    console.log('Instruction entered.');

    // 2. Submit instruction
    //    (Update selector if needed)
    const submitButton = page.locator('button[type="submit"]'); // Placeholder selector
    await submitButton.click();
    console.log('Instruction submitted.');

    // 3. Confirm the step
    //    Wait for the confirmation modal/step review to appear
    //    (Update selectors if needed)
    const reviewModal = page.locator('.step-review-modal'); // Placeholder selector
    await reviewModal.waitFor({ state: 'visible', timeout: 15000 });
    console.log('Review modal appeared.');

    const confirmButton = reviewModal.locator('button:has-text("Confirm")'); // Placeholder selector
    await confirmButton.waitFor({ state: 'enabled', timeout: 5000 });
    await confirmButton.click();
    console.log('Step confirmed.');

    // 4. Verify completion/success
    //    Wait for a status update in the UI indicating success.
    //    This is an indirect way to check if the navigation likely happened
    //    in the separate Playwright-MCP browser instance.
    //    (Update selector and expected text if needed)
    const statusIndicator = page.locator('#status-hud-message'); // Placeholder selector
    await expect(statusIndicator).toContainText(/Session completed|Step successful/i, { timeout: 30000 }); // Example success text
    console.log('Success status verified.');

    // Optional: Add a small delay to observe the final state if running headed.
    // await page.waitForTimeout(2000);

  });
}); 