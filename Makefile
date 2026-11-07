.PHONY: clear
clear:
	rm -rf node_modules dist *.vsix

build:
	npm install
	npm run package
