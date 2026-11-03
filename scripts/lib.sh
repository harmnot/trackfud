# Trackfud — shared shell helpers for scripts/build.sh and scripts/podman-up.sh.
# Sourced (not executed): `source scripts/lib.sh` from the repo root.
# shellcheck shell=bash

# Build --build-arg flags from VITE_* lines in a dotenv file.
# Prints one --build-arg per line to stdout; caller collects into array.
build_args_from_env() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    # trim leading/trailing whitespace
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" =~ ^VITE_[A-Za-z0-9_]*= ]]; then
      local key="${line%%=*}"
      local value="${line#*=}"
      # strip surrounding single or double quotes
      if [[ "$value" =~ ^\".*\"$ ]]; then
        value="${value:1:-1}"
      elif [[ "$value" =~ ^\'.*\'$ ]]; then
        value="${value:1:-1}"
      fi
      printf '%s\n' "--build-arg"
      printf '%s\n' "${key}=${value}"
    fi
  done < "$file"
}
