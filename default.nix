# nix-shell entry point; the dev shell itself is defined in flake.nix.
(builtins.getFlake (toString ./.)).devShells.${builtins.currentSystem}.default
