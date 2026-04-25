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
            nodejs_24
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
            echo "opencode: $(opencode --version)"
            # Ensure npm dependencies are installed
            if [ ! -d node_modules ]; then
              echo "Installing npm dependencies..."
              ${pkgs.nodejs_24}/bin/npm install || { echo "Error: npm install failed"; exit 1; }
            fi
            # Ensure vitest is installed
            ${pkgs.nodejs_24}/bin/npm install vitest 2>/dev/null || \
              { echo "Error: npm install vitest failed"; exit 1; }
            # Add node_modules/.bin to PATH
            export PATH=$PWD/node_modules/.bin:$PATH
            # Verify vitest installation
            if command -v vitest >/dev/null 2>&1; then
              echo "Vitest: $(vitest --version)"
            else
              echo "Error: vitest not found after installation"
              exit 1
            fi
            echo "Environment ready. Run 'vitest run' or 'npm test' to execute tests."
          '';
        };
      }
    );
}
