# Primitive makefile for including just required files in the distribution.
FILES=dashboard.html index.html options.html profiles.html manifest.json
DIRS=images styles js fonts
DIST=dist
JS=background.js dashboard.js drive-sync.js engine.js history-logger.js import-export.js index.js migration.js options.js profiles.js reminders.js storage.js url-rules.js
CSS=dashboard.css index.css options.css normalize.css
JSMIN=npx --no-install uglify-js --compress --mangle
CSSMIN=npx --no-install sass --stdin --style=compressed

dist: clean copy minify pack

copy:
	@echo "### Copying files"
	cp -R $(DIRS) $(FILES) $(DIST)

minify: $(JS) $(CSS)
	@echo "### Minification complete"

%.js:
	cat $(DIST)/js/$@ | $(JSMIN) > $(DIST)/js/$@.minify
	mv $(DIST)/js/$@.minify $(DIST)/js/$@

%.css:
	cat $(DIST)/styles/$@ | $(CSSMIN) > $(DIST)/styles/$@.minify
	mv $(DIST)/styles/$@.minify $(DIST)/styles/$@

pack:
	@echo "### Packing..."
	find $(DIST) -name '.DS_Store' -delete
	cd $(DIST); python3 -m zipfile -c dist.zip *

clean:
	rm -rf $(DIST)
	mkdir dist
