# Context

if you read @./PLAN.md, for courier who want to earns money (biker or runner) based on @./frontend-biker-runner they have status that admin needs to approve to be partner and review their data, also @./frontend-merchant that register , admin on cms should also approve or reject it.

we should create a system where the admin can review and approve/reject the status of couriers and merchants. we should follow features on the CMS based on the @./backend API endpoints.

for the admin page we should have a dashboard that shows the list of couriers and merchants with their status (pending, approved, rejected) and the ability to approve or reject them. The admin should also be able to view the details of each courier and merchant, including their personal information, documents, and any other relevant data.

we only have login only no signup for admin, make sure it has email and password validation, and the admin should be able to log in and log out of the system, when logged in, the admin should be able to see the dashboard and perform the necessary actions. if the admin is not logged in, they should be redirected to the login page.

when the @./backend API endpoints not exist what we need, create the endpoints and make sure they are secure and follow best practices. we should also create unit tests for the API endpoints to ensure they are working as expected.

make sure that the color scheme and components and style should be consistent with the @./frontend-biker-runner and @./frontend-merchant, and we should use the same design system. it must ultra-high quality and responsive for all devices and animation style experience, and we should also make sure that the UI is user-friendly and easy to navigate.

always update @./docs/milestone-checklist.md for our progress and make sure to follow the @./docs/README.md for the project structure and guidelines.

# Task

- Create an admin dashboard for reviewing and approving/rejecting couriers and merchants.
- Implement login functionality for the admin with email and password validation.
- Fetch data from the backend API endpoints for couriers and merchants.
- Implement the ability to view details of each courier and merchant, including personal information and documents.
- Implement the ability to approve or reject couriers and merchants.
- Create necessary backend API endpoints if they do not exist, ensuring they are secure and follow best practices.
- Create unit tests for the backend API endpoints to ensure they are working as expected.
- Ensure the color scheme, components, and style are consistent with the existing frontend applications.
- Ensure the UI is user-friendly, responsive, and provides a smooth animation experience.
- Update the milestone checklist and follow the project structure and guidelines as outlined in the README.md.

# Constraints

- must modularize the code and make sure the code is clean and maintainable.
- do not hardcode any data, all data should be fetched from the API.
- mock data only for unit testing purpose, and make sure the mock data is realistic and relevant to the app's functionality.
- no sensitive information should be exposed in the code or in the API responses.
- ensure proper error handling and validation for all API endpoints.
- ensure that the admin dashboard is accessible only to logged-in admins and that unauthorized access is prevented.
- ensure that the application is secure against common web vulnerabilities, such as SQL injection, XSS, and CSRF attacks.
- ensure that the application is optimized for performance and scalability, with efficient data fetching and rendering.
- always check @./PLAN.md for any updates or changes to the project requirements and make sure to implement them accordingly.