#!/bin/sh
# run before each push: stamps a new version so open pages reload themselves
V=$(date +%s); echo "{\"v\":\"$V\"}" > version.json
sed -i "s/const APP_VERSION=\"[0-9]*\"/const APP_VERSION=\"$V\"/" index.html flx.html archive.html new.html
