import { getDocument } from "pdfjs-dist";
import Path from "path";
import fs from "fs";
import http from "http";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const mysql = require("mysql");

const hostname = "127.0.0.1";
const port = 8080;

const server = http.createServer(async (req, res) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain");
  res.end("connected\n");
});

server.listen(port, hostname, () => {
  console.log(`Server is running on http://${hostname}:${port}`);
});

const connection = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "asunafo",
});

connection.connect();

async function processPDFDirectory(directoryPath) {
  try {
    const files = fs.readdirSync(directoryPath);
    for (const file of files) {
      const filePath = Path.join(directoryPath, file);
      const fileNameLower = file.toLowerCase();
      if (fs.statSync(filePath).isFile() && fileNameLower.endsWith("_transferred.pdf")) {
        const success = await processPDFFile(filePath);
        if (success) {
          console.log("PDF file processed successfully:", filePath);
        }
      }
    }
  } catch (error) {
    console.error("Error processing PDF files:", error);
  }
}

async function processPDFFile(filePath) {
  try {
    console.log(`Processing file: ${filePath}`);
    const doc = await getDocument(filePath).promise;
    const lines = await processDoc(doc);
    const lines1 = await processDoc1(doc);
    const pollingInfo = await PollingStationinfo(lines1);
    const region = await extractRegion(lines);  
    const voterData1 = await extractVoterText(doc);
    const voterData = await extractVoterData(voterData1);   
    const voterInfo = await allvoterinfo(pollingInfo, voterData,region);
   //console.log(lines1);
   // console.log("Polling Info:", voterData);
   
   // console.log("Voter Data:", voterInfo);

    for (const voter of voterInfo) {
      const {region, pscode, psname, constituency, voterid, name, reason, pstransfer, psnameto} = voter;
      // Define the query with ON DUPLICATE KEY UPDATE
      const insertQuery = `
        INSERT INTO voterdata (region, pscode, psname, constituency, voterid, name, reason, pstransfer, psnameto) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          duplicate = 1;
      `;
      
      await new Promise((resolve, reject) => {
        connection.query(insertQuery, [region, pscode, psname, constituency, voterid, name, reason, pstransfer, psnameto], (error, results) => {
          if (error) {
            console.log(error?.stack || "Unknown error");
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }

    return true;
  } catch (error) {
    console.error("Error occurred during extraction for file:", filePath);
    const insertQuery = 'INSERT INTO errorlog SET ?';
    const insertData = { 
      errormsg: error.message, 
      path: filePath,
      sqlerror: error.sql,
      sqlMessages: error.sqlMessage,
      sqlStates: error.sqlState 
    };
    await new Promise((resolve, reject) => {
      connection.query(insertQuery, insertData, (err, resmsg) => {
        if (err) {
          console.error("Error inserting error log:", err);
          reject(err);
        } else {
          console.log("Error log inserted with ID:", resmsg.insertId);
          resolve();
        }
      });
    });
    return false;
  }
}

async function processDoc(doc) {
  try {
    const lines = [];
    for (let i = 2; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const text1 = textContent.items.map((item) => item.str).join(" ");

      const unwantedPatterns = [
        /THE ELECTORAL COMMISSION OF GHANA - VOTERS REGISTER - TRANSFERRED VOTER LIST 2024/g,
        /Constituency:\s+\w+/g,
        /#\s+VOTER ID and NAME REASON Polling Station Transferred From/g,
        /Page \d+ of \d+/g,
        /Summary for Polling Station/g,
        /Total Number of Voters : \d+/g,
        /NO EXTRACTS FROM OR COPIES OF THIS REGISTER SHOULD BE MADE WITHOUT THE PERMISSION IN WRITING OF THE ELECTORAL COMMISSION OF GHANA./g,
        /TRANSFERRED VOTERS LIST/g,
        /VOTERS REGISTER 2024/g,
        /HE ELECTORAL COMMISSION OF GHANA - VOTERS REGISTER - TRANSFERRED VOTER LIST 2024/g,
        /^\d{1,3}\s+/gm,
        /^\d{1,3}\s+\d+/gm,
      ];

      let text2 = text1;
      unwantedPatterns.forEach(pattern => {
        text2 = text2.replace(pattern, "");
      });

      text2 = text2.replace(/\b([1-9]|[1-5][0-9]|600)\b/g, "");

      const commaRegex = /,/g;
      const textCommas = text2.replace(commaRegex, "");
      const searchText = "Tick  Name:";
      const regex = new RegExp(searchText, "g");
      const replacedText = textCommas.replace(regex, ":name");
      const sregex = /(\s{2,})(?=:\w)/g;
      const usern = replacedText.replace(sregex, "");
      const doubleSpace = usern.trim();
      const liness = doubleSpace.split(/\s{2,}/);
      lines.push(...liness);
    }

    return lines;
  } catch (err) {
    console.log("Error processing document:", err);
    return [];
  }
}

async function processDoc1(doc) {
  try {
    const lines = [];
    
    for (let i = 2; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      let text = textContent.items.map((item) => item.str).join(" ");

      // Replace specific text with ":name"
      const searchText = "Tick  Name:";
      const searchTextRegex = new RegExp(searchText, "g");
      const replacedText = text.replace(searchTextRegex, ":name");

      // Remove double spaces before specific patterns
      const doubleSpaceRegex = /(\s{2,})(?=:\w)/g;
      const cleanedText = replacedText.replace(doubleSpaceRegex, "");

      // Split the cleaned text into lines based on multiple spaces
      const splitLines = cleanedText.trim().split(/\s{2,}/);
      lines.push(...splitLines);
    }

    return lines;
  } catch (err) {
    console.log("Error processing document:", err);
    return [];
  }
}




async function PollingStationinfo(arr) {
  const info = {};
  let currentKey = null;

  for (const item of arr) {
    if (item.startsWith("Region:")) {
      info["Region"] = arr[arr.indexOf(item) + 4];
    } else if (item.startsWith("PS Code:")) {
      info["PS Code"] = item.split(": ")[1];
    } else if (item.startsWith("Polling Station Name:")) {
      info["Polling Station Name"] = arr[arr.indexOf(item) + 1];
    } else if (item.startsWith("Constituency:")) {
      info["Constituency"] = arr[arr.indexOf(item) + 1];
    }
  }

  return info;
}

async function extractRegion(arr) {
  const regionIndex = arr.indexOf("Region:");
  return regionIndex !== -1 ? arr[regionIndex + 4] : "";
}

async function extractVoterData(arr) {
  const voters = [];
  
  // Ensure arr is an array and not empty
  if (!Array.isArray(arr) || arr.length === 0) {
    console.error("Invalid input: arr should be a non-empty array");
    return voters;
  }

  for (let i = 0; i < arr.length; i++) {
    // Check if current item seems to be a Voter ID and Name
    if (/^\d{10}/.test(arr[i])) {
      // Extract voter ID and name
      const [voterid, ...nameParts] = arr[i].split(' ');
      const name = nameParts.join(' ');

      // Check if there are enough items for the next fields
      if (i + 2 < arr.length) {
        const reason = arr[i + 1];
        const pollingStationTransferred = arr[i + 2];

        // Split the polling station information into code and name
        const [pollingStationCode, ...pollingStationNameParts] = pollingStationTransferred.split(' ');
        const polling_station_transferred = pollingStationNameParts.join(' ');

        // Push the formatted voter data to the array
        const voter = {
          voterid,
          name,
          reason,
          polling_station_code: pollingStationCode,
          polling_station_transferred: polling_station_transferred
        };
        voters.push(voter);
        i += 2; // Skip to the next potential entry
      } else {
        // Log if there aren't enough items left to form a complete voter entry
        console.warn("Not enough data to create a full voter entry at index:", i);
      }
    }
  }

  return voters;
}



/*
async function extractVoterText(doc) {
  try {
    const lines = [];

    for (let i = 2; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      let text = textContent.items.map((item) => item.str).join(" ");

      // Patterns to remove unwanted text
      const unwantedPatterns = [
        /THE ELECTORAL COMMISSION OF GHANA - VOTERS REGISTER - TRANSFERRED VOTER LIST 2024/g,
        /Constituency:\s+\w+/g,
        /Page \d+ of \d+/g,
        /Summary for Polling Station/g,
        /Total Number of Voters : \d+/g,
        /NO EXTRACTS FROM OR COPIES OF THIS REGISTER SHOULD BE MADE WITHOUT THE PERMISSION IN WRITING OF THE ELECTORAL COMMISSION OF GHANA./g,
        /TRANSFERRED VOTERS LIST/g,
        /VOTERS REGISTER 2024/g,
        /HE ELECTORAL COMMISSION OF GHANA - VOTERS REGISTER - TRANSFERRED VOTER LIST 2024/g,
        /^\d{1,3}\s+/gm, // Removes lines that start with numbers followed by spaces
        /^\d{1,3}\s+\d+/gm, // Removes lines with numbers
        /#\s+VOTER ID and NAME REASON Polling Station Transferred From/g,
        /REASON #/g, // Removes 'REASON #'
        /Polling Station Transferred From/g, // Removes 'Polling Station Transferred From'
        /#\s+/g, // Removes '#' followed by any spaces
        /Region:/g, // Removes 'Region:'
        /PS Code:\s+\S+/g, // Removes 'PS Code:' and its value
        /Polling Station Name:/g, // Removes 'Polling Station Name:'
        /YAKOTE CLINIC/g, // Removes 'YAKOTE CLINIC'
        /UPPER EAST/g, // Removes 'UPPER EAST'
        /VOTER ID and NAME/g // Removes 'VOTER ID and NAME'
      ];

      unwantedPatterns.forEach(pattern => {
        text = text.replace(pattern, "");
      });

      // Removes single-digit and small numbers
      text = text.replace(/\b([1-9]|[1-5][0-9]|600)\b/g, "");

      // Remove commas
      text = text.replace(/,/g, "");

      // Splitting the cleaned text into an array of lines
      const linesArray = text.trim().split(/\s{2,}/);
      lines.push(...linesArray);
    }

    // Return the cleaned lines
    return lines;
  } catch (err) {
    console.error("Error processing document:", err);
    return [];
  }
}*/

async function extractVoterText(doc) {
  try {
    const lines = [];

    for (let i = 2; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      let text = textContent.items.map((item) => item.str).join(" ");

      // Patterns to remove unwanted text
      const unwantedPatterns = [
        /THE ELECTORAL COMMISSION OF GHANA - VOTERS REGISTER - TRANSFERRED VOTER LIST 2024/g,
        /Constituency:\s+\w+/g,
        /Page \d+ of \d+/g,
        /Summary for Polling Station/g,
        /Total Number of Voters : \d+/g,
        /NO EXTRACTS FROM OR COPIES OF THIS REGISTER SHOULD BE MADE WITHOUT THE PERMISSION IN WRITING OF THE ELECTORAL COMMISSION OF GHANA./g,
        /TRANSFERRED VOTERS LIST/g,
        /VOTERS REGISTER 2024/g,
        /HE ELECTORAL COMMISSION OF GHANA - VOTERS REGISTER - TRANSFERRED VOTER LIST 2024/g,
        /^\d{1,3}\s+/gm, // Removes lines that start with numbers followed by spaces
        /^\d{1,3}\s+\d+/gm, // Removes lines with numbers
        /#\s+VOTER ID and NAME REASON Polling Station Transferred From/g,
        /REASON #/g, // Removes 'REASON #'
        /Polling Station Transferred From/g, // Removes 'Polling Station Transferred From'
        /#\s+/g, // Removes '#' followed by any spaces
        /Region:/g, // Removes 'Region:'
        /PS Code:\s+\S+/g, // Removes 'PS Code:' and its value
        /Polling Station Name:/g, // Removes 'Polling Station Name:'
        /YAKOTE CLINIC/g, // Removes 'YAKOTE CLINIC'
        /UPPER EAST/g, // Removes 'UPPER EAST'
        /VOTER ID and NAME/g // Removes 'VOTER ID and NAME'
      ];

      unwantedPatterns.forEach(pattern => {
        text = text.replace(pattern, "");
      });

      // Removes single-digit and small numbers
      text = text.replace(/\b([1-9]|[1-5][0-9]|600)\b/g, "");

      // Remove commas
      text = text.replace(/,/g, "");

      // Splitting the cleaned text into an array of lines
      const linesArray = text.trim().split(/\s{2,}/);
      lines.push(...linesArray);
    }

    // Return the cleaned lines
    return lines;
  } catch (err) {
    console.error("Error processing document:", err);
    return [];
  }
}


 
async function allvoterinfo(pollingInfo, voterData) {
  const allVoterData = [];  
  for (const voter of voterData) {
    const {
      Region: region,
      'PS Code': pscode,
      'Polling Station Name': psname,      
      Constituency: constituency,
    } = pollingInfo ?? {};
    
    const {
      voterid,
      name,
      reason,
      polling_station_transferred: pstransfer,
      polling_station_code: psnameto,
    } = voter ?? {};

    const combinedData = {
      region,
      pscode,
      psname,
      constituency,
      voterid,
      name,
      reason,
      pstransfer,
      psnameto,
    };

    allVoterData.push(combinedData);
  }

  return allVoterData;
}

const pdfDirectoryPath = "./pdf";
async function main() {
  await processPDFDirectory(pdfDirectoryPath);
}

main();


