// todo: turn tenant public
describe('Login page & login form', () => {
  it('load well', () => {
    cy
      .clearCookie('daikoku-session')
      .visit('http://localhost:9000')
      .url().should('include', '/apis')
      .get('h1.jumbotron-heading').should('have.text', 'Evil Corp.');
  });
});

describe('API page', () => {
  it('load well', () => {
    cy
      .visit('http://localhost:9000/testers/test-api')
      .get('h1.jumbotron-heading').should(($div) => {
        expect($div.text().trim()).contains('test API');
      })
      .get('a.nav-link').contains('Plans').click()
      .get('.card').should('have.length', 2)
      .get('a.nav-link').contains('Documentation').click()
      .get('.api-description #introduction').should('have.text', 'Introduction')
      .get('a.nav-link').contains('Api Reference').should('not.exist')
      .get('a.nav-link').contains('Try it !').should('not.exist');
  });
});

describe('Team apis page', () => {
  it('load well', () => {
    cy
      .visit('http://localhost:9000/testers')
      .get('h1.jumbotron-heading').should('have.text', 'Testers');
  });
});