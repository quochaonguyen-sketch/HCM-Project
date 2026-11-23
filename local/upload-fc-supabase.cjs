/**
 * Automated script to upload FC T1126 forecast data to Supabase PostgREST.
 * Reads parsed data from local/forecast-t11-data.private.json or workbooks.private.json.
 */
const fs = require('fs');
const path = require('path');

function getSupabaseConfig() {
  const envPath = path.join(__dirname, '..', '.env');
  let key = '';
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^SUPABASE_KEY=([^\r\n]+)/m);
    if (match) key = match[1].trim();
  }
  const url = process.env.SUPABASE_URL || 'https://aqvcybxcfgicxmzpczgd.supabase.co';
  return { url: url.replace(/\/$/, ''), key };
}

async function uploadFcT11() {
  const { url, key } = getSupabaseConfig();
  if (!key) {
    console.error('Error: SUPABASE_KEY not found in .env');
    process.exit(1);
  }

  const dataPath = path.join(__dirname, 'forecast-t11-data.private.json');
  if (!fs.existsSync(dataPath)) {
    console.log('Generating forecast-t11-data.private.json first...');
    require('./generate-forecast-seed.cjs');
  }

  const records = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  console.log(`Ready to upload ${records.length} FC T11 records to ${url}/rest/v1/forecast_daily`);

  // 1. Check if table exists
  const checkRes = await fetch(`${url}/rest/v1/forecast_daily?limit=1`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  });

  if (checkRes.status === 404) {
    console.error('\n[NOTICE] Table public.forecast_daily does not exist in Supabase yet.');
    console.error('Please run the migration in Supabase SQL Editor:');
    console.error('  File: supabase/migrations/20261119010000_forecast_daily.sql');
    console.error('Or execute seed file directly:');
    console.error('  File: supabase/migrations/20261119010001_seed_forecast_daily_t11.sql\n');
    return { ok: false, status: 404, message: 'Table not found. Run migration first.' };
  }

  if (!checkRes.ok && checkRes.status !== 200 && checkRes.status !== 206) {
    const errText = await checkRes.text();
    console.error(`Check failed with status ${checkRes.status}: ${errText}`);
    return { ok: false, status: checkRes.status, message: errText };
  }

  // 2. Upload in batches
  const batchSize = 500;
  let uploaded = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const postRes = await fetch(`${url}/rest/v1/forecast_daily`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(batch)
    });

    if (!postRes.ok) {
      const errText = await postRes.text();
      console.error(`Batch ${i / batchSize + 1} failed: ${errText}`);
      return { ok: false, error: errText };
    }
    uploaded += batch.length;
    console.log(`Uploaded ${uploaded}/${records.length} records...`);
  }

  console.log(`\nSuccessfully uploaded ${uploaded} records to Supabase forecast_daily!`);
  return { ok: true, uploaded };
}

if (require.main === module) {
  uploadFcT11().catch(err => {
    console.error('Upload error:', err);
    process.exit(1);
  });
}

module.exports = { uploadFcT11 };
