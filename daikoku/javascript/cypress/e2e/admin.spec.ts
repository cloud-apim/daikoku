describe('Messages page', () => {
  it('load well', () => {
    //@ts-ignore
    cy.login('admin@foo.bar', 'password')
      .visit('http://localhost:9000/apis')
      .get('.navbar a.messages-link').click()
      .url().should('include', '/settings/messages')
      .get('.navbar-companion .block__entry__link.active').should('have.text', 'Messages');
  });
});

describe('Oto instances page', () => {
  it('load well', () => {
    //@ts-ignore
    cy.login('admin@foo.bar', 'password')
      .visit('http://localhost:9000/settings/settings/general')
      .get('.navbar-companion .block__entry__link').contains('Otoroshi instances').click()
      .url().should('include', '/settings/otoroshis')
      .get('table tbody tr').should('have.length', 1)
      .get('table tbody tr .btn-outline-primary').click()
      .url().should('include', '/settings/otoroshis/default')
      .get('.wrapper form').should('be.visible');
  });
});

describe('Admins page', () => {
  it('load well', () => {
    //@ts-ignore
    cy.login('admin@foo.bar', 'password')
      .visit('http://localhost:9000/settings/settings/general')
      .get('.navbar-companion .block__entry__link').contains('Admins').click()
      .url().should('include', '/settings/admins')
      .get('.avatar-with-action').should('have.length', 1);
  });
});

describe('Audit trail page', () => {
  it('load well', () => {
    //@ts-ignore
    cy.login('admin@foo.bar', 'password')
      .visit('http://localhost:9000/settings/settings/general')
      .get('.navbar-companion .block__entry__link').contains('Audit trail').click()
      .url().should('include', '/settings/audit')
      .get('table').should('is.visible');
  });
});

describe('teams page', () => {
  it('load well', () => {
    //@ts-ignore
    cy.login('admin@foo.bar', 'password')
      .visit('http://localhost:9000/settings/settings/general')
      .get('.navbar-companion .block__entry__link').contains('Teams').click()
      .url().should('include', '/settings/teams')
      .get('.avatar-with-action:not(.new-team-button)').should('have.length', 6)
      .visit('http://localhost:9000/settings/teams/consumers/members')
      .get('.avatar-with-action').should('have.length', 1);
  });
});

describe('tenants page', { scrollBehavior: false }, () => {
  it('load well', () => {
    //@ts-ignore
    cy.login('admin@foo.bar', 'password')
      .visit('http://localhost:9000/settings/tenants')
      .get('.navbar-companion .block__entry__link.active').should('have.text', 'Tenants')
      .get('.avatar-with-action').should('have.length', 1)
      .visit('http://localhost:9000/settings/tenants/evil-corp./general')
      .get('.wrapper h1').should('have.text', 'Evil Corp. - General');
  });
});

describe('users page', { scrollBehavior: false }, () => {
  it('load well', () => {
    //@ts-ignore
    cy.login('admin@foo.bar', 'password')
      .visit('http://localhost:9000/settings/tenants')
      .get('.navbar-companion .block__entry__link').contains('Users').click({ force: true })
      .url().should('include', '/settings/users')
      .get('.avatar-with-action').should('have.length', 3)
      .visit('http://localhost:9000/settings/users/admin-foo.bar')
      .get('input[name="name"]').should('have.value', 'Admin');
  });
});

// describe('create new api version', () => {
//   it('load well', () => {
//     const version = "1.0.1"
//     cy.visit('http://localhost:9000/apis')
//       .url().should('include', '/apis')
//       .visit('http://localhost:9000/')
//       .get('.row:nth-child(3) > .col-12 h3').click()
//       .url().should('include', 'testers/test-api/1.0.0')
//       .get('.btn-sm:nth-child(1)').click({ force: true })
//       .get('.navbar-companion .btn-outline-primary').contains('New version').click()
//       .get('.form-control:nth-child(2)').click()
//       .get('.form-control:nth-child(2)').type(version)
//       .get('.modal-footer > .btn-outline-success').click()
//       .visit(`http://localhost:9000/testers/test-api/1.0.1/description`)
//       .url().should('include', `/testers/test-api/1.0.1/description`)
//       .get('.reactSelect__control').first().should('have.text', version)
//   })
// })