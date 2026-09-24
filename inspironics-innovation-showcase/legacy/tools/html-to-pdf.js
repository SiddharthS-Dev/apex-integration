#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function main(){
  const args = process.argv.slice(2);
  if(args.length < 1){
    console.error('Usage: node html-to-pdf.js <input.html> [output.pdf] [--format=A4]');
    process.exit(2);
  }
  const input = args[0];
  const output = args[1] && !args[1].startsWith('--') ? args[1] : input.replace(/\.html?$/i,'.pdf');
  const formatArg = args.find(a=>a.startsWith('--format=')) || '--format=A4';
  const format = formatArg.split('=')[1] || 'A4';

  const inputPath = path.resolve(input);
  if(!fs.existsSync(inputPath)){
    console.error('Input HTML not found:', inputPath);
    process.exit(2);
  }

  let puppeteer;
  try{
    puppeteer = require('puppeteer');
  }catch(e){
    console.error('Please install puppeteer first:');
    console.error('  cd tools && npm install puppeteer');
    process.exit(2);
  }

  const url = pathToFileURL(inputPath).href;
  const browser = await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  try{
    const page = await browser.newPage();
    await page.goto(url, {waitUntil: 'networkidle0'});
    await page.pdf({path: output, format: format, printBackground: true});
    console.log('Wrote PDF:', output);
  }catch(err){
    console.error('Error generating PDF:', err);
    process.exit(1);
  }finally{
    await browser.close();
  }
}

main();
