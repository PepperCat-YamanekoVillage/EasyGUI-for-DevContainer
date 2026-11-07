#!/bin/sh
# Downloads X11 test applications (xterm, xclock, GTK3 demo, gtkwave, PyQt5)
# into a private directory WITHOUT root and without touching the container's
# system directories, so the integration test can exercise real toolkits.
#
#   test/setup-test-apps.sh <dir>
#
# Prints an env file path; source it to get TEST_APPS_* variables.
set -eu
DIR=$(realpath -m "${1:?usage: setup-test-apps.sh <dir>}")
mkdir -p "$DIR/apt/lists/partial" "$DIR/apt/cache/archives/partial" "$DIR/debs" "$DIR/root"
cat > "$DIR/apt/apt.conf" <<EOF
Dir::State::Lists "$DIR/apt/lists";
Dir::Cache "$DIR/apt/cache";
Debug::NoLocking "true";
Acquire::Languages "none";
EOF
export APT_CONFIG="$DIR/apt/apt.conf"
apt-get update -qq 2>/dev/null || true
PKGS=$(apt-get -s install --no-install-recommends xterm x11-apps gtk-3-examples gtkwave python3-pyqt5 2>/dev/null | awk '/^Inst/{print $2}')
cd "$DIR/debs"
apt-get download $PKGS >/dev/null 2>&1
for f in *.deb; do dpkg-deb -x "$f" "$DIR/root"; done
R="$DIR/root"
TRIPLET=$(gcc -dumpmachine 2>/dev/null || echo "$(uname -m)-linux-gnu")
LIB="$R/usr/lib/$TRIPLET"
# Post-install steps that dpkg would normally run.
GCS=$(ls "$LIB/glib-2.0/glib-compile-schemas" 2>/dev/null || command -v glib-compile-schemas || true)
[ -n "$GCS" ] && LD_LIBRARY_PATH="$LIB" "$GCS" "$R/usr/share/glib-2.0/schemas" || echo "warning: glib-compile-schemas not found; GTK apps may not start" >&2
LOADERS=$(ls -d "$LIB"/gdk-pixbuf-2.0/2.10.0/loaders 2>/dev/null || true)
if [ -n "$LOADERS" ] && [ -x "$LIB/gdk-pixbuf-2.0/gdk-pixbuf-query-loaders" ]; then
  LD_LIBRARY_PATH="$LIB" "$LIB/gdk-pixbuf-2.0/gdk-pixbuf-query-loaders" "$LOADERS"/*.so > "$DIR/loaders.cache" 2>/dev/null || true
fi
cat > "$DIR/env.sh" <<EOF
export TEST_APPS_ROOT="$R"
export TEST_APPS_ENV="LD_LIBRARY_PATH=$LIB GSETTINGS_SCHEMA_DIR=$R/usr/share/glib-2.0/schemas XDG_DATA_DIRS=$R/usr/share:/usr/share $( [ -s "$DIR/loaders.cache" ] && echo "GDK_PIXBUF_MODULE_FILE=$DIR/loaders.cache" ) PYTHONPATH=$R/usr/lib/python3/dist-packages QT_PLUGIN_PATH=$LIB/qt5/plugins"
EOF
echo "$DIR/env.sh"
