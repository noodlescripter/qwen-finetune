const fs = require('fs');
const path = require('path');
const http = require('http');

// Configuration
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:5001/api/webhook';
const RESULTS_DIR = process.argv[2] || __dirname;

// Parse webhook URL
const url = new URL(WEBHOOK_URL);

function sendResults(results) {
  const data = JSON.stringify({ results });

  const options = {
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve({ status: res.statusCode, data: response });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function processFile(filePath) {
  const fileName = path.basename(filePath);
  console.log(`\n📁 Processing: ${fileName}`);

  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const results = JSON.parse(fileContent);

    const passed = results.filter(r => r.state === 'passed').length;
    const failed = results.filter(r => r.state === 'failed').length;
    console.log(`   Found ${results.length} tests (✅ ${passed} passed, ❌ ${failed} failed)`);

    const response = await sendResults(results);

    if (response.status === 201) {
      console.log(`   ✅ Sent successfully`);
      console.log(`      Execution: ${response.data.executionId}`);
      console.log(`      Saved: ${response.data.saved} | Analyzing: ${response.data.failed}`);

      if (response.data.unmatched?.length > 0) {
        console.log(`      ⚠️  Unmatched: ${response.data.unmatched.join(', ')}`);
      }

      return { success: true, saved: response.data.saved, failed: response.data.failed };
    } else {
      console.log(`   ❌ Error (${response.status}): ${JSON.stringify(response.data)}`);
      return { success: false, error: response.data };
    }
  } catch (error) {
    console.log(`   ❌ Failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('📤 Test Results Sender');
  console.log('='.repeat(50));
  console.log(`🎯 Webhook: ${WEBHOOK_URL}`);
  console.log(`📂 Directory: ${RESULTS_DIR}`);

  // Find all JSON files in the directory
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(RESULTS_DIR, f));

  if (files.length === 0) {
    console.log('\n❌ No JSON files found in directory');
    process.exit(1);
  }

  console.log(`\n📋 Found ${files.length} JSON file(s)`);

  // Process each file
  let totalSaved = 0;
  let totalFailed = 0;
  let successCount = 0;

  for (const file of files) {
    const result = await processFile(file);
    if (result.success) {
      successCount++;
      totalSaved += result.saved || 0;
      totalFailed += result.failed || 0;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Summary:');
  console.log(`   Files processed: ${successCount}/${files.length}`);
  console.log(`   Total results saved: ${totalSaved}`);
  console.log(`   Total failures analyzing: ${totalFailed}`);
}

main();
