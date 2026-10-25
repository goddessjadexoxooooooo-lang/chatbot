async function loadAdminData() {
  const container = document.getElementById('admin-container');

  try {
    const response = await fetch('/api/admin/applications');
    const data = await response.json();

    if (!response.ok || !data.applications) {
      throw new Error('Unable to load applications');
    }

    if (!data.applications.length) {
      container.innerHTML = '<p>No applications have been started yet.</p>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'apps-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>ID</th>
          <th>Status</th>
          <th>Payment</th>
          <th>Approval</th>
          <th>Access</th>
          <th>Submitted</th>
          <th>Answers</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    data.applications.forEach((application) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${application.id.slice(0, 8)}</td>
        <td>${application.status}</td>
        <td>${application.paymentStatus}</td>
        <td>${application.approvalStatus}</td>
        <td>${application.accessStatus}</td>
        <td>${application.submittedAt || 'Not submitted'}</td>
        <td>${JSON.stringify(application.answers)}</td>
      `;
      tbody.appendChild(row);
    });

    container.appendChild(table);
  } catch (error) {
    container.innerHTML = `<p>Error: ${error.message}</p>`;
  }
}

loadAdminData();
