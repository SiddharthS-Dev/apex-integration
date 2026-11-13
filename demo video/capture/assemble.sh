#!/usr/bin/env bash
# Run in the Linux VM (or anywhere with ffmpeg) from this folder after capture:
#   bash assemble.sh [narration.mp3|wav] [subs.srt]
set -e
cd "$(dirname "$0")/out"
ffmpeg -y -f concat -safe 0 -i frames.ffconcat -vf "fps=30,scale=1920:1080,format=yuv420p" -c:v libx264 -crf 18 -preset veryfast -pix_fmt yuv420p raw_tmp.mp4
mv raw_tmp.mp4 screen_1080p.mp4
if [ -n "$1" ]; then
  SUB=${2:+,subtitles=$2:force_style='FontName=Arial,FontSize=22,PrimaryColour=&HFFFFFF&,BackColour=&H80000000&,BorderStyle=4,Outline=1,Shadow=0,MarginV=40'}
  ffmpeg -y -i screen_1080p.mp4 -i "$1" -vf "format=yuv420p$SUB" -map 0:v -map 1:a -c:v libx264 -crf 18 -preset veryfast -c:a aac -b:a 192k -shortest final_tmp.mp4
  mv final_tmp.mp4 Apex_Product_Demo.mp4
fi
