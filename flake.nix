{
  description = "Pushbullet chrome extension";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs
            nix-ld
            typescript
            esbuild # build
            prettier # format js/ts
            biome # format json
          ];

          shell = "${pkgs.zsh}/bin/zsh";

          shellHook = ''
            echo "Setting up environment for Pushbullet Chrome Extension"
            echo "Node.js: $(node --version)"
            echo "npm: $(npm --version)"
            echo "esbuild: $(esbuild --version)"
            # Add node_modules/.bin to PATH
            export PATH=$PWD/node_modules/.bin:$PATH
            # Install project dependencies from the lock file only when absent.
            # Never block shell load: warn instead of exiting.
            if [ ! -d node_modules ]; then
              echo "Installing npm dependencies from package-lock.json..."
              npm ci || echo "Warning: npm ci failed; run 'npm ci' manually. Continuing without dependencies."
            fi
            if command -v vitest >/dev/null 2>&1; then
              echo "Vitest: $(vitest --version)"
            else
              echo "Warning: vitest not found; run 'npm ci' to install dependencies."
            fi
            echo "Environment ready. Run 'vitest run' or 'npm test' to execute tests."
          '';
        };
      }
    );
}
