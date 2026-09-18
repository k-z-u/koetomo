#!/bin/bash
# ダブルクリックで起動：http://localhost:8765 で開く（マイクは localhost / https でのみ動作）
cd "$(dirname "$0")"
( sleep 1; open "http://localhost:8765/" ) &
python3 -m http.server 8765
