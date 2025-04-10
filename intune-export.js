#!/usr/bin/env node
require("dotenv").config();
const axios = require("axios");
const qs = require("qs");
const fs = require("fs");
const sqlite3 = require("sqlite3");
const gplay = require("google-play-scraper");
const store = require("app-store-scraper");
const { program } = require("commander");
const { Parser } = require("json2csv");
const log = require("./lib/logger");
const dbUtils = require("./lib/db");

program
  .requiredOption("--tenantId <tenantId>", "Azure Tenant ID")
  .requiredOption("--clientId <clientId>", "Azure Client ID")
  .option("--debug", "Enable debug logging")
  .option("--metadata", "Enrich app metadata")
  .option("--output <filename>", "Filename", "intune_apps");

program.parse(process.argv);
const opts = program.opts();

if (opts.debug) {
  log.level = "debug";
}
log.debug("Debug logging enabled");

opts.tenantId = opts.tenantId || process.env.TENANT_ID;
opts.clientId = opts.clientId || process.env.CLIENT_ID;
opts.clientSecret = process.env.CLIENT_SECRET;

if (!opts.tenantId || !opts.clientId || !opts.clientSecret) {
  console.error(
    "Please provide the tenantId, clientId and clientSecret as environment variables or command line arguments"
  );
  process.exit(1);
}

(async () => {
  try {
    const token = await getToken(
      opts.tenantId,
      opts.clientId,
      opts.clientSecret
    );
    const apps = await getIntuneApps(token);

    // if output directory doesn't exist, create it
    if (!fs.existsSync("output")) {
      fs.mkdirSync("output");
    }

    const db = await initAppDb();
    await addAppsToDb(db, apps);

    if (opts.metadata) {
      log.debug("Enriching app metadata");
      // we'll need to enrich the app metadata
      // but we need to wait 5 seconds between requests
      // and we don't want to hit the API too hard
      // so we'll use a for loop with a delay
      const sqlSelect = `SELECT * FROM app WHERE title IS NULL`;
      const paramsSelect = [];
      const dbApps = await dbUtils.all(db, sqlSelect, paramsSelect);

      // process each app but wait 5 seconds between requests
      for (let i = 0; i < dbApps.length; i++) {
        const app = dbApps[i];
        await enrichAppMetadata(app, db);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    await exportToCsvAndJson(db, opts.output);
  } catch (err) {
    console.error("Error:", err.message);
  }
})();

async function getToken(tenantId, clientId, clientSecret) {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const data = {
    client_id: clientId,
    scope: "https://graph.microsoft.com/.default",
    client_secret: clientSecret,
    grant_type: "client_credentials",
  };

  const response = await axios.post(url, qs.stringify(data), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return response.data.access_token;
}

async function getIntuneApps(token) {
  const url = "https://graph.microsoft.com/v1.0/deviceAppManagement/mobileApps";
  const headers = { Authorization: `Bearer ${token}` };

  let results = [];
  let next = url;

  while (next) {
    const res = await axios.get(next, { headers });
    results = results.concat(res.data.value);
    next = res.data["@odata.nextLink"];
  }

  return results;
}

async function addAppsToDb(db, apps) {
  // we'll add the apps to the database
  // we'll track the id from the API as the intuneAppId
  // to determine the platform, we'll look at the json field @odata.type
  // the platform will be android or ios
  // if the json packageId is not null, we'll use that
  // otherwise we'll need to use the appStoreUrl to find the packageId or iTunesId
  // we'll need to parse the appStoreUrl to get the packageId or iTunesId
  // the platformAppKey will be the combination of the platform, a "-" and then the packageId or iTunesId

  for (const app of apps) {
    try {
      let platform = null;
      if (app["@odata.type"].includes("android")) {
        platform = "android";
      } else if (app["@odata.type"].includes("ios")) {
        platform = "ios";
      } else {
        log.error("Unsupported platform %s", app["@odata.type"]);
        continue;
      }

      // determine the packageId or iTunesId and set the platformAppKey
      const packageId = app.packageId;
      let itunesId = null;
      if (platform === "ios") {
        itunesId = await getPackageOrItunesId(app.appStoreUrl);
      }
      const appIdentifier = packageId || itunesId;

      const platformAppKey = `${platform}-${packageId || itunesId}`;

      // check if the app already exists in the database
      const sqlSelect = `
      SELECT * FROM app WHERE platformAppKey = ?
      `;
      const paramsSelect = [platformAppKey];
      const rows = await dbUtils.all(db, sqlSelect, paramsSelect);
      if (rows.length > 0) {
        log.debug("App %s already exists in the database", platformAppKey);
        continue;
      }
      // insert the app into the database
      const sqlInsert = `
      INSERT INTO app (intuneAppId, platformAppKey, packageId, itunesId, appIdentifier, platform)
      VALUES (?, ?, ?, ?, ?, ?)
      `;
      const paramsInsert = [
        app.id,
        platformAppKey,
        packageId,
        itunesId,
        appIdentifier,
        platform,
      ];
      await dbUtils.run(db, sqlInsert, paramsInsert);
      log.info("Inserted app %s into the database", platformAppKey);
    } catch (error) {
      log.error("Error processing app insertion: %s", error);
    }
  }
}

function getPackageOrItunesId(url) {
  // we'll parse the appStoreUrl to get the packageId or iTunesId
  // here's two appStoreUrls examples:
  // ios: https://apps.apple.com/us/app/facebook/id284882215?uo=4
  // android: https://play.google.com/store/apps/details?id=com.einnovation.temu&hl=en_US
  // if the url starts with https://play.google.com/store/apps/details?id=, we'll
  // parse the Android packageId id from the url after the & and ignore the & and anything after if present
  // if the url start with https://apps.apple.com/us/app/, we'll parse the iTunesId from the url
  // for iOS, we'll split the url by / and take the last part and ignore the ? and anything after
  // we'll also remove the "id" from the iTunesId and only keep the number
  // we'll return the packageId or iTunesId

  let packageOrItunesId = null;
  if (url.startsWith("https://play.google.com/store/apps/details?id=")) {
    url = url.replace("https://play.google.com/store/apps/details?id=", "");
    url = url.split("&")[0];
    packageOrItunesId = url;
  } else if (url.startsWith("https://apps.apple.com/us/app/")) {
    url = url.replace("https://apps.apple.com/us/app/", "");
    url = url.split("?")[0];
    const parts = url.split("/");
    packageOrItunesId = parts[parts.length - 1].replace("id", "");
  }
  log.debug("Parsed appStoreUrl %s to %s", url, packageOrItunesId);
  return packageOrItunesId;
}

async function exportToCsvAndJson(db, fileName) {
  // we'll export the data from the database to a CSV file
  const sqlSelect = `SELECT * FROM app`;
  const paramsSelect = [];
  const rows = await dbUtils.all(db, sqlSelect, paramsSelect);

  const parser = new Parser();
  const csv = parser.parse(rows);
  fs.writeFileSync(`output/${fileName}.csv`, csv);
  fs.writeFileSync(`output/${fileName}.json`, JSON.stringify(rows, null, 2));
  log.info(
    "Exported data to output/%s.csv & output/%s.json",
    fileName,
    fileName
  );
}

async function enrichAppMetadata(appData, db) {
  // we'll select all the apps from the database
  // if the title is null, we'll enrich the app metadata
  // get the app metadata using the appropriate gplay or store api
  // we'll then update the database with the metadata
  // title, url, description, minInstalls, maxInstalls, icon, primaryGenre,
  // releasedAt, updatedAt, developerId, developerEmail, developer, developerUrl,
  // developerWebsite, developerAddress, score, reviews, ratings, ratingsHistogram
  // if the dates are not in milliseconds, we'll convert them to milliseconds

  const platformAppKey = appData.platformAppKey;
  const platform = appData.platform;
  const packageId = appData.packageId;
  const itunesId = appData.itunesId;
  let appMetadata = null;
  try {
    if (platform === "android") {
      appMetadata = await gplay.app({ appId: packageId, throttle: 1 });
    } else if (platform === "ios") {
      log.debug("Fetching iOS app metadata for %s", itunesId);
      appMetadata = await store.app({ id: itunesId, ratings: true });
    } else {
      log.error("Unsupported platform %s", platform);
      return;
    }
  } catch (error) {
    log.error("Error fetching %s metadata: %s", platformAppKey, error.message);
    // let's update the title with the error so we don't keep rechecking it
    const sqlUpdate = `
      UPDATE app SET title = ? WHERE platformAppKey = ?
    `;
    const paramsUpdate = [error.message, platformAppKey];
    db.run(sqlUpdate, paramsUpdate, (err) => {
      if (err) {
        log.error(
          "Error updating app metadata for %s: %s",
          platformAppKey,
          err
        );
      } else {
        log.info(
          "Updated app metadata for %s with error message",
          platformAppKey
        );
      }
    });
    return;
  }

  if (!appMetadata) {
    log.error("No app metadata found for %s", platformAppKey);
    return;
  }

  log.debug("App metadata %O", appMetadata);

  // we'll check to see if the dates are in milliseconds
  // if not, we'll convert them to milliseconds
  if (typeof appMetadata.released === "string") {
    appMetadata.released = new Date(appMetadata.released).getTime();
  }
  if (typeof appMetadata.updated === "string") {
    appMetadata.updated = new Date(appMetadata.updated).getTime();
  }
  if (typeof appMetadata.released === "number") {
    appMetadata.released = Math.floor(appMetadata.released / 1000);
  }
  if (typeof appMetadata.updated === "number") {
    appMetadata.updated = Math.floor(appMetadata.updated / 1000);
  }

  const genre =
    platform === "android" ? appMetadata.genre : appMetadata.primaryGenre;
  // now we'll update the database with the metadata
  const sqlUpdate = `
    UPDATE app SET
      packageId = ?,
      title = ?,
      url = ?,
      description = ?,
      minInstalls = ?,
      maxInstalls = ?,
      icon = ?,
      primaryGenre = ?,
      releasedAt = ?,
      updatedAt = ?,
      developerId = ?,
      developerEmail = ?,
      developer = ?,
      developerUrl = ?,
      developerWebsite = ?,
      developerAddress = ?,
      score = ?,
      reviews = ?,
      ratings = ?,
      ratingsHistogram = ?
    WHERE platformAppKey = ?
  `;
  const paramsUpdate = [
    appData.packageId,
    appMetadata.title,
    appMetadata.url,
    appMetadata.description,
    appMetadata.minInstalls,
    appMetadata.maxInstalls,
    appMetadata.icon,
    genre,
    appMetadata.released,
    appMetadata.updated,
    appMetadata.developerId,
    appMetadata.developerEmail,
    appMetadata.developer,
    appMetadata.developerUrl,
    appMetadata.developerWebsite,
    appMetadata.developerAddress,
    appMetadata.score,
    appMetadata.reviews,
    appMetadata.ratings,
    JSON.stringify(appMetadata.histogram),
    platformAppKey,
  ];
  db.run(sqlUpdate, paramsUpdate, (err) => {
    if (err) {
      log.error("Error updating app metadata for %s: %s", platformAppKey, err);
    } else {
      log.info("Updated app metadata for %s", platformAppKey);
    }
  });
}

async function initAppDb() {
  // let's initialize our analysis database if it doesn't exist
  const db = new sqlite3.cached.Database("output/intune-apps.db", (err) => {
    if (err) {
      log.error("Error connecting to output/intune-app.db sqlite database");
    }
    log.debug("Connected to output/intune-app.db sqlite database");
  });
  db.serialize(() => {
    // create an app table
    db.run(`
        CREATE TABLE IF NOT EXISTS app (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          intuneAppId TEXT UNIQUE,
          platformAppKey TEXT UNIQUE,
          packageId TEXT,
          itunesId TEXT,
          appIdentifier TEXT,
          platform TEXT,
          title TEXT,
          url TEXT,
          description TEXT,
          minInstalls INTEGER,
          maxInstalls INTEGER,
          icon TEXT,
          primaryGenre TEXT,
          releasedAt INTEGER,
          updatedAt INTEGER,
          developerId TEXT,
          developerEmail TEXT,
          developer TEXT,
          developerUrl TEXT,
          developerWebsite TEXT,
          developerAddress TEXT,
          score REAL,
          reviews INTEGER,
          ratings INTEGER,
          ratingsHistogram BLOB
        );
      `);
  });
  return db;
}
