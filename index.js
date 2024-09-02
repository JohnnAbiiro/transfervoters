import { getDocument, OPS } from "pdfjs-dist";
import sharp from "sharp";
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

// PDF directory
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

connection.connect();

/*
async function processPDFFile(filePath) {
  try {
    console.log(`Processing file: ${filePath}`);
    const doc = await getDocument(filePath).promise;
    const lines = await processDoc(doc);   
    const pollingInfo = await PollingStationinfo(lines);
    const region = await extractRegion(lines);
    const voterData = await extractVoterData(lines);
    const voterInfo = await allvoterinfo(pollingInfo, voterData);
    console.log(voterInfo);
    // console.log("Polling Info:", pollingInfo);
   // console.log("Region:", region);
  // console.log("Voter Data:", voterInfo);
     
    for (const voter of voterInfo) { 
      const {region,pscode,psname,constituency, voterid,name,reason,pstransfer , psnameto } = voter;   
      const insertData = {      
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
      const insertQuery = 'INSERT INTO voterdata SET ?'; 
      await new Promise((resolve, reject) => {
        connection.query(insertQuery, [insertData], (error, results) => {
          if (error) {
            console.log(error);
            reject(error);
          } 
          else {
            resolve();
          }
        });
      });
    }
    

    return true;
  } catch (error) {
    console.error("Error occurred during extraction for file:", filePath);
    console.log("Inserted ID:", error.insertId);
    const insertquery = 'INSERT INTO errorlog SET ?';
    const insertdata = { errormsg: error.message, path: filePath ,sqlerror:error.sql,sqlMessages:error.sqlMessage,sqlStates:error.sqlState};
    connection.query(insertquery, insertdata, (err, resmsg) => {
   if (err) console.error("Error inserting error log:", err);
   else console.log("Error log inserted with ID:", resmsg.insertId);
   });
    return false;
  }
}*/
async function processPDFFile(filePath) {
  try {
    console.log(`Processing file: ${filePath}`);
    const doc = await getDocument(filePath).promise;
    const lines = await processDoc(doc);
    const pollingInfo = await PollingStationinfo(lines);
    const region = await extractRegion(lines);
    const voterData = await extractVoterData(lines);
    const voterInfo = await allvoterinfo(pollingInfo, voterData);
   // console.log(voterInfo);

    for (const voter of voterInfo) { 
      const { region, pscode, psname, constituency, voterid, name, reason, pstransfer, psnameto } = voter;

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
    console.log("Inserted ID:", error.insertId);
    const insertquery = 'INSERT INTO errorlog SET ?';
    const insertdata = { errormsg: error.message, path: filePath ,sqlerror:error.sql,sqlMessages:error.sqlMessage,sqlStates:error.sqlState};
    connection.query(insertquery, insertdata, (err, resmsg) => {
      if (err) console.error("Error inserting error log:", err);
      else console.log("Error log inserted with ID:", resmsg.insertId);
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
      const text2 = text1.replace(/THE ELECTORAL COMMISSION OF GHANA - VOTERS REGISTER - 2023/g, "");
      const commaRegex = /,/g;
      const textCommas = text2.replace(commaRegex, "");
      const searchText = "Tick  Name:";
      const regex = new RegExp(searchText, "g");
      const replacedText = textCommas.replace(regex, ":name");
      const sregex = /(\s{2,})(?=:\w)/g;
      const usern = replacedText.replace(sregex, "");
      const doubleSpace = usern.trim();
      const liness = doubleSpace.split(/\s{2,}/); // split double spacing
      lines.push(...liness);
    }

    return lines;
  } catch (err) {
    console.log("Error processing document:", err);
    return []; // or handle the error appropriately
  }
}

// Polling station information
async function PollingStationinfo(arr) {
  const info = {};
  let currentKey = null;

  for (const item of arr) {
    if (item.startsWith("Region:")) {
      info["Region"] = arr[arr.indexOf(item) + 4];  // Extracting Region based on its position
    } else if (item.startsWith("PS Code:")) {
      info["PS Code"] = item.split(": ")[1];
    } else if (item.startsWith("Polling Station Name:")) {
      info["Polling Station Name"] = arr[arr.indexOf(item) + 1]; // Assuming the name is the next line
    } else if (item.startsWith("Constituency:")) {
      info["Constituency"] = arr[arr.indexOf(item) + 1]; // Extracting Constituency based on its position
    }
  }
  
  return info;
}

// Extract region
async function extractRegion(arr) {
  const regionIndex = arr.indexOf("Region:");
  return regionIndex !== -1 ? arr[regionIndex + 4] : ""; // Assuming Region is on the 5th position after "Region:"
}

// Extract detailed voter data
async function extractVoterData(arr) {
  const voters = [];
  
  for (let i = 0; i < arr.length; i++) {
    if (/^\d+$/.test(arr[i])) {  // Check if the item is just a number, indicating start of a voter entry
      const voter = {
        voterid: arr[i + 1].split(' ')[0],  // Voter ID is the first part before the space
        name: arr[i + 1].split(' ').slice(1).join(' '), // Name is everything after the Voter ID
        reason: arr[i + 2],  // Reason is in the next line
        polling_station_transferred: arr[i + 3].split(' ')[0], // Polling station code
        polling_station_name: arr[i + 3].split(' ').slice(1).join(' ') // Polling station name
      };
      voters.push(voter);
    }
  }

  return voters;
}

// Combine polling info with voter data
async function allvoterinfo(pollingInfo, voterData) {
  const allVoterData = [];  
  for (const voter of voterData) {
    const{
      Region:region,
     'PS Code':pscode,
     'Polling Station Name':psname,
      Constituency:constituency,
      }= pollingInfo ?? {};
     
     const{
     voterid:voterid,
     name:name,
     reason:reason,
     polling_station_transferred:pstransfer,
      polling_station_name:psnameto
     }= voter ??{};

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

// const outputFolder = `E:/${region}/${consit}`
// const outputFolder = `E:/GREATER ACCRA/ABLEKUMA NORTH`
// const outputfolder = `/${region}/${consit}`
const pdfDirectoryPath = "./pdf";
async function main() {
  await processPDFDirectory(pdfDirectoryPath);
}

main();
