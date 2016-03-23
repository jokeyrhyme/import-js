// Class that sorts ImportStatements as they are pushed in
const flattenDeep = require('lodash.flattendeep');
const partition = require('lodash.partition');
const uniqWith = require('lodash.uniqwith');

const STYLE_IMPORT = 'import';
const STYLE_CONST = 'const';
const STYLE_VAR = 'var';
const STYLE_CUSTOM = 'custom';

// Order is significant here
const STYLES = Object.freeze([
  STYLE_IMPORT,
  STYLE_CONST,
  STYLE_VAR,
  STYLE_CUSTOM,
]);

const PATH_TYPE_CORE_MODULE = 'core_module';
const PATH_TYPE_PACKAGE = 'package';
const PATH_TYPE_NON_RELATIVE = 'non_relative';
const PATH_TYPE_RELATIVE = 'relative';

// Order is significant here
const PATH_TYPES = Object.freeze([
  PATH_TYPE_CORE_MODULE,
  PATH_TYPE_PACKAGE,
  PATH_TYPE_NON_RELATIVE,
  PATH_TYPE_RELATIVE,
]);

const GROUPINGS_ARRAY = Object.freeze(flattenDeep(
  STYLES.map(style => (
    PATH_TYPES.map(location => `${style} ${location}`)
  )))
);

const GROUPINGS = {};
GROUPINGS_ARRAY.forEach((group, index) => {
  GROUPINGS[group] = index;
});
Object.freeze(GROUPINGS);

class ImportStatements {
  // @param config [ImportJS::Configuration]
  // @param imports [Hash]
  initialize(config, imports = {}) {
    this.config = config;
    this.imports = imports;
  }

  clone() {
    return new ImportStatements(this.config, Object.extend({}, this.imports));
  }

  // @param import_statement [ImportJS::ImportStatement]
  // @return [ImportJS::ImportStatements]
  push(importStatement) {
    const existingStatement = this.imports[importStatement.path];
    if (existingStatement) {
      // Import already exists, so this line is likely one of a named imports
      // pair. Combine it into the same ImportStatement.
      existingStatement.merge(importStatement);
    } else {
      // This is a new import, so we just add it to the hash.
      this.imports[importStatement.path] = importStatement;
    }

    return this; // for chaining
  }

  // @param variable_names [Array<String>]
  // @return [ImportJS::ImportStatements]
  deleteVariables(variableNames) {
    Object.keys(this.imports).forEach((key) => {
      const importStatement = this.imports[key];
      variableNames.forEach((variableName) => {
        importStatement.deleteVariable(variableName);
      });
      if (importStatement.isEmpty()) {
        delete this.imports[key];
      }
    });

    return this; // for chaining
  }

  // Convert the import statements into an array of strings, with an empty
  // string between each group.
  // @return [Array<String>]
  toArray() {
    const maxLineLength = this.config.get('max_line_length');
    const tab = this.config.get('tab');

    const strings = [];
    this._toGroups().forEach((group) => {
      group.forEach((importStatement) => {
        strings.concat(importStatement.toImportStrings(maxLineLength, tab));
      });
      strings.push(''); // Add a blank line between groups.
    });

    // We don't want to include a trailing newline at the end of all the
    // groups here.
    if (strings[strings.length - 1] === '') {
      strings.pop();
    }

    return strings;
  }

  // Sort the import statements by path and group them based on our heuristic
  // of style and path type.
  // @return [Array<Array<ImportJS::ImportStatement>>]
  _toGroups() {
    const groups = [];

    const importsArray = Object.values(this.imports);

    // There's a chance we have duplicate imports (can happen when switching
    // declaration_keyword for instance). By first sorting imports so that new
    // ones are first, then removing duplicates, we guarantee that we delete
    // the old ones that are now redundant.
    let partitioned = partition(importsArray, importStatement => (
      !importStatement.isParsedAndUntouched()
    ));
    partitioned = flattenDeep(partitioned);
    partitioned.sort(is => is.toNormalized());
    partitioned = uniqWith(partitioned, is => is.toNormalized());

    if (!this.config.get('group_imports')) {
      return [partitioned];
    }

    const packageDependencies = this.config.packageDependencies();
    const coreModules = this.config.environmentCoreModules();
    partitioned.forEach((importStatement) => {
      // Figure out what group to put this import statement in
      const groupIndex = this._importStatementGroupIndex(
        importStatement,
        packageDependencies,
        coreModules
      );

      // Add the import statement to the group
      groups[groupIndex] = groups[groupIndex] || [];
      groups[groupIndex].push(importStatement);
    });

    if (groups.length) {
      groups.filter((group) => group); // compact
    }
    return groups;
  }

  // @param import_statement [ImportJS::ImportStatement]
  // @param package_dependencies [Array<String>]
  // @param core_modules [Array<String>]
  // @return [Number]
  _importStatementGroupIndex(importStatement, packageDependencies, coreModules) {
    const style = this._importStatementStyle(importStatement);
    const pathType = this._importStatementPathType(
      importStatement, packageDependencies, coreModules);

    return GROUPINGS[`${style} ${pathType}`];
  }

  // Determine import statement style
  // @param import_statement [ImportJS::ImportStatement]
  // @return [String] 'import', 'const', 'var', or 'custom'
  _importStatementStyle(importStatement) {
    if (importStatement.declarationKeyword === 'imports') {
      return STYLE_IMPORT;
    }

    if (importStatement.importFunction === 'require') {
      if (importStatement.declarationKeyword === 'const') {
        return STYLE_CONST;
      }
      if (importStatement.declarationKeyword === 'var') {
        return STYLE_VAR;
      }
    }

    return STYLE_CUSTOM;
  }

  // Determine import path type
  // @param import_statement [ImportJS::ImportStatement]
  // @param package_dependencies [Array<String>]
  // @param core_modules [Array<String>]
  // @return [String] 'package, 'non-relative', 'relative'
  _importStatementPathType(importStatement, packageDependencies, coreModules) {
    if (importStatement.path.startsWith('.')) {
      return PATH_TYPE_RELATIVE;
    }

    if (coreModules.includes(importStatement.path)) {
      return PATH_TYPE_CORE_MODULE;
    }

    // If there is a slash in the path, remove that and everything after it.
    // This is so that imports for modules inside package dependencies end up
    // in the right group (PATH_TYPE_PACKAGE).
    const path = importStatement.path.replace(/\A(.*?)\/.*\Z/, '$1');
    if (packageDependencies.includes(path)) {
      return PATH_TYPE_PACKAGE;
    }

    return PATH_TYPE_NON_RELATIVE;
  }
}

module.exports = ImportStatements;