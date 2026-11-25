#!/bin/sh
# Render the standard SF50 review views with the stand-alone viewer into <outdir>/<tag>-<view>.png (one headless browser session).
# usage: tools/sf50-shots.sh <outdir> <tag> [views...]   (needs vite on :5202: node node_modules/vite/bin/vite.js --port 5202 --host 127.0.0.1)
OUT=${1:?outdir}; TAG=${2:?tag}; shift 2; S=sf50model; B=http://127.0.0.1:5202/tools/viewer/sf50-viewer.html; M=${SF50_MODEL:-SF50}
mkdir -p "$OUT"; VIEWS=${*:-side top front34 rear34 cockpit cabin tail engine nose}
q() { case $1 in
  side) echo "cam=0,1.7,-17&look=0,1.5,0&fov=30";;
  top) echo "cam=0.4,20,0&look=0,0,0&fov=30";;
  front34) echo "cam=11,2.6,-8&look=0,1.4,0&fov=34";;
  rear34) echo "cam=-11,3.4,-8&look=-2,2.2,0&fov=34";;
  cockpit) echo "cam=1.66,1.84,-0.37&look=4,1.45,-0.15&fov=75";;
  cabin) echo "cam=0.1,1.5,0.15&look=2.0,1.2,-0.15&fov=80";;
  tail) echo "cam=-9,3.2,-4&look=-3.5,2.4,0&fov=22";;
  engine) echo "cam=-6.5,4.2,-4.5&look=-2.5,2.4,0&fov=24";;
  nose) echo "cam=9,1.4,-3.5&look=3.5,1.2,0&fov=24";;
  frontHigh) echo "cam=14,5.5,0&look=-2,2.2,0&fov=22";;
  rearHigh) echo "cam=-7.5,5.2,0&look=0,2,0&fov=45";;
esac; }
for v in $VIEWS; do
  agent-browser --session $S open "$B?model=$M&w=1100&h=700&$(q $v)${X:+&$X}" >/dev/null 2>&1
  agent-browser --session $S wait 2500 >/dev/null 2>&1
  agent-browser --session $S screenshot "$OUT/$TAG-$v.png" >/dev/null 2>&1
done
agent-browser --session $S close >/dev/null 2>&1
ls "$OUT" | grep "^$TAG-" | tr '\n' ' '
