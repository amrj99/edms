# Engineering Document & Project Management System (EDMS SaaS)
## System Requirements Specification (SRS)

---

# 1. System Overview

## 1.1 System Name
Engineering Document & Project Management System (EDMS)

## 1.2 System Type
Cloud based SaaS platform for:

- Engineering document management
- Project collaboration
- Correspondence management
- Construction inspection tracking
- Multi‑company project coordination

The system must support two working modes:

1. **Company Workspace** (internal company use)
2. **Project Workspace** (multi‑company collaboration)

---

# 2. Core Concept of the Platform

The platform structure is based on:

Organization → Projects → Modules

Example:

Organization (Company)
   └ Projects
        ├ Documents
        ├ Correspondence
        ├ Registers
        ├ Tasks
        ├ Meetings
        ├ Inspections
        ├ Reports
        └ AI Assistant

Companies can:

• use the system internally
• participate in shared projects

---

# 3. User Roles

System roles:

Admin  
Document Controller  
Engineer  
Reviewer  
Approver  
External User  
Viewer

Each role has permission control based on:

• organization
• project
• document type
• workflow stage

---

# 4. Organization Types

Client  
Consultant  
Main Contractor  
Subcontractor  
Authority  
General

Organizations can be invited to projects.

External companies can join projects without owning a full system workspace.

---

# 5. Main System Modules

## 5.1 Dashboard

Shows:

• Tasks assigned to user
• Pending approvals
• Unread correspondence
• Late responses
• Recent documents
• Project statistics
• Notifications

Optional widgets:

• Organization chart
• Project statistics
• Inspection statistics

---

# 6. Project Module

Each project contains:

Project Dashboard
Documents
Correspondence
Registers
Meetings
Tasks
Inspections
Reports
AI Assistant
Settings

Project dashboard shows:

• active tasks
• pending responses
• document activity
• project team

---

# 7. Document Management Module

## 7.1 Document Structure

Each document includes:

Document File  
Metadata  
Revision History  
Workflow Status  
Linked Correspondence  
Attachments

## 7.2 Document Version Control

System must support:

• unlimited revisions
• revision comparison
• revision history log

Example:

Document Rev0  
Document Rev1  
Document Rev2

---

# 8. Document Upload Methods

System must support multiple upload methods:

### 1. Standard Upload

User uploads file through interface and fills metadata.

### 2. Server Sync Folder

A monitored folder on server automatically imports files.

### 3. Bulk Import

Upload Excel + files to import large document sets.

### 4. Email Import

Send documents via project email address.

Example:

project1@edms-system.com

Attachments automatically stored inside project.

---

# 9. Document Metadata Fields

Example metadata fields:

Activities
Actual Completion Date
Approval Date
Area
Client Reference
Consultant Reference
Subcontractor Reference
Document Type
Document Source
Discipline
Drawing Number
Drawing Type
Inspection Date
Issued By
Location
Revision
Status
Submission Date
Received Date
Remarks

Metadata fields vary depending on document type.

---

# 10. Document Status Types

Approved  
Approved as noted  
Revise and resubmit  
Rejected  
Cancelled  
Closed  
Superseded  
Under review

---

# 11. Correspondence Module

Interface similar to email client.

Folders:

Inbox
Sent
Draft
Archive

Correspondence types:

Transmittal
Email
Letter
Memo
Notice
RFI
Meeting Minutes

Each correspondence contains:

Sender
Receiver
Subject
Message body
Attachments
Reference numbers
Response tracking

---

# 12. Registers and Reports

System automatically generates registers.

Examples:

Master Document Register
Drawings Register
Correspondence Register
NCR Register
NOC Register
ITR / MIR Register

Reports must support:

• filtering
• column customization
• Excel export

---

# 13. Task Management

Each user sees tasks in "My Tasks".

Tasks may originate from:

Document review
Correspondence
Meetings
Inspections
Workflow approvals

Task status:

Open
In Progress
Pending External Response
Completed
Closed

---

# 14. Meetings Module

Features:

Create meeting
Upload meeting recording
Automatic meeting minutes generation
Task extraction from meeting

AI can summarize meetings.

---

# 15. Inspection Module

Used for site inspections.

Supports:

ITR
MIR
NCR
SOR

Mobile users can submit inspection requests.

---

# 16. Workflow Engine

Standard workflow:

Upload
Review
Approval
Issued

System must support:

• configurable workflows
• role-based routing
• automatic notifications

---

# 17. Distribution Matrix

Each project defines document distribution rules.

Example:

Document Type → Receivers

Drawings → Consultant + Client  
Inspection Requests → Consultant  
Reports → Client

---

# 18. AI Assistant Features

AI features include:

Document summarization
Email reply suggestions
Document classification
Smart search
Project knowledge assistant

Optional feature:

Project Knowledge Base.

AI can answer questions about project documents.

---

# 19. Chat System

Real-time chat system similar to messaging apps.

Features:

Project group chat
Private chat
File sharing
Message history

---

# 20. Security and Permissions

Security model:

Role Based Access Control (RBAC)

Permissions defined by:

Organization
Project
User Role
Document Level

Additional security:

Confidential document flag
Audit log tracking

---

# 21. Storage Options

The system supports two storage models:

### Cloud Storage

Used for SaaS customers.

### Customer Private Storage

Large organizations can store files on their own server.

---

# 22. Database Architecture

Recommended database:

PostgreSQL

Core tables:

Organizations
Users
Projects
Documents
DocumentVersions
Correspondence
Tasks
Registers
Meetings
Inspections
Notifications
AuditLogs

---

# 23. Technology Stack Recommendation

Frontend:

React
TypeScript

Backend:

Node.js
NestJS

Database:

PostgreSQL

Search Engine:

Elasticsearch

File Storage:

Cloud Object Storage

---

# 24. Notifications System

System notifications include:

Email notifications
In‑app notifications
Task reminders
Deadline alerts

---

# 25. System Integrations

Potential integrations:

Email systems
CAD software
Scheduling systems
ERP systems

---

# 26. Mobile Support

Mobile application required for:

Inspection submission
Photo upload
Task updates
Notifications

---

# 27. Audit Logging

System records:

Document uploads
Document edits
User actions
Approvals

Audit logs cannot be deleted.

---

# 28. Multi‑Language Support

System must support:

English
Arabic

---

# 29. SaaS Multi‑Tenant Architecture

Each company operates as a tenant.

Tenant isolation required for:

Data
Storage
Permissions

---

# 30. Future Expansion Capabilities

System must allow future modules such as:

BIM integration
Advanced analytics
Predictive project insights
Contract management

---

# 31. Database Schema (High Level)

Below is the initial database structure required to implement the system. The schema follows a multi‑tenant SaaS architecture where organizations own projects and users can participate across projects based on permissions.

## Core Tables

### Organizations
Stores companies using the system.

Fields:
- id (PK)
- name
- organization_type
- address
- contact_email
- created_at

### Users
System users.

Fields:
- id (PK)
- organization_id (FK)
- name
- email
- password_hash
- role
- status
- created_at

### Projects
Projects managed in the system.

Fields:
- id (PK)
- name
- description
- client_organization_id
- start_date
- end_date
- created_at

### ProjectOrganizations
Companies participating in projects.

Fields:
- id (PK)
- project_id (FK)
- organization_id (FK)
- role

---

# Document Management Tables

### Documents
Main document record.

Fields:
- id (PK)
- project_id
- document_number
- document_type
- discipline
- title
- status
- revision
- created_by
- created_at

### DocumentVersions
Tracks revisions.

Fields:
- id (PK)
- document_id
- revision
- file_path
- uploaded_by
- uploaded_at

### DocumentMetadata
Stores metadata values dynamically.

Fields:
- id (PK)
- document_id
- field_name
- field_value

### DocumentAttachments
Additional files.

Fields:
- id (PK)
- document_id
- file_path

---

# Correspondence Tables

### Correspondence
Stores communications.

Fields:
- id (PK)
- project_id
- type
- subject
- message
- sender_id
- created_at

### CorrespondenceRecipients
Recipients list.

Fields:
- id (PK)
- correspondence_id
- user_id

### CorrespondenceAttachments
Attachments.

Fields:
- id (PK)
- correspondence_id
- file_path

---

# Workflow Tables

### Workflows
Defines workflow templates.

Fields:
- id (PK)
- name
- document_type

### WorkflowSteps
Steps of approval.

Fields:
- id (PK)
- workflow_id
- step_order
- role_required

### WorkflowInstances
Workflow instances running for a document.

Fields:
- id (PK)
- workflow_id
- document_id
- current_step

---

# Task Management

### Tasks
User tasks.

Fields:
- id (PK)
- project_id
- assigned_to
- title
- description
- status
- due_date

---

# Meetings

### Meetings

Fields:
- id (PK)
- project_id
- title
- meeting_date
- organizer

### MeetingNotes

Fields:
- id (PK)
- meeting_id
- notes

---

# Inspections

### Inspections

Fields:
- id (PK)
- project_id
- inspection_type
- location
- inspection_date
- status

---

# Registers

### Registers

Fields:
- id (PK)
- project_id
- register_type

### RegisterEntries

Fields:
- id (PK)
- register_id
- related_document_id

---

# Notifications

### Notifications

Fields:
- id (PK)
- user_id
- message
- is_read
- created_at

---

# Audit Logs

### AuditLogs

Fields:
- id (PK)
- user_id
- action
- entity_type
- entity_id
- timestamp

---

# End of Specification


