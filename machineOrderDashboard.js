import { LightningElement, wire, track } from 'lwc';
import getMachinesWithJobs from '@salesforce/apex/MachineOrderDashboardController.getMachinesWithJobs';
import updateJobStatus from '@salesforce/apex/MachineOrderDashboardController.updateJobStatus';
import splitOrderToMachines from '@salesforce/apex/MachineOrderDashboardController.splitOrderToMachines';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';

export default class MachineOrderDashboard extends LightningElement {
    @track machineRecords = [];
    wiredMachinesResult;
    draggedJobId = null;
    isFirstLoad = true;
    manualJobOrders = new Map(); // Store manual job ordering for each machine

    // Auto-scroll properties
    autoScrollInterval = null;
    scrollSpeed = 0;
    horizontalScrollSpeed = 0;
    scrollZoneSize = 300; // pixels from edge to start scrolling

    @wire(getMachinesWithJobs)
    wiredMachines(result) {
        this.wiredMachinesResult = result;
        if (result.data) {
            this.processMachineData(result.data);
            this.isFirstLoad = false;
        } else if (result.error) {
            console.error('Error loading machine records:', result.error);
            this.showToast('Error', 'Error loading machine records', 'error');
        }
    }

    processMachineData(machinesData) {
        // First, sort machines to ensure consistent sequential order
        const sortedMachines = [...machinesData].sort((a, b) => {
            const nameA = a.Machine_Nickname__c || '';
            const nameB = b.Machine_Nickname__c || '';

            // Extract numbers from machine names for proper numerical sorting
            const getSequenceNumber = (name) => {
                // Look for patterns like "Machine 1", "M1", "Machine1", etc.
                const match = name.match(/(\\d+)/);
                return match ? parseInt(match[1], 10) : 0;
            };

            const numA = getSequenceNumber(nameA);
            const numB = getSequenceNumber(nameB);

            // If both have numbers, sort by number
            if (numA !== 0 && numB !== 0) {
                return numA - numB;
            }

            // If only one has a number, prioritize the one with number
            if (numA !== 0) return -1;
            if (numB !== 0) return 1;

            // If neither has numbers, sort alphabetically
            if (nameA !== nameB) {
                return nameA.localeCompare(nameB);
            }

            // If names are the same, sort by Id
            return a.Id.localeCompare(b.Id);
        });

        const processedData = sortedMachines.map(machine => {
            const machineJobs = machine.Machine_Jobs__r || [];

            const usedCapacity = machineJobs.reduce((sum, job) => sum + (job.Job_Quantity_oz__c || 0), 0);
            const remainingCapacity = (machine.Capacity_oz__c || 0) - usedCapacity;

            const allJobs = machineJobs.map(job => {
                const diffValue = job.Diff_between_Out_Date_And_Cut_off_Date__c;
                let diffClass = '';

                if (diffValue !== null && diffValue !== undefined) {
                    if (diffValue < 0) {
                        diffClass = 'early-value';
                    } else if (diffValue > 0) {
                        diffClass = 'late-value';
                    }
                }

                // Defensive null checking for Order__r relationship
                // Ensure Order__r exists to prevent template errors
                return { 
                    ...job, 
                    diffClass,
                    Order__r: job.Order__r || null
                };
            });

            allJobs.sort((a, b) => {
                if (a.Date_In__c && b.Date_In__c) {
                    return new Date(a.Date_In__c) - new Date(b.Date_In__c);
                } else if (a.Date_In__c) {
                    return -1;
                } else if (b.Date_In__c) {
                    return 1;
                } else {
                    return 0;
                }
            });

            if (this.isFirstLoad && allJobs.length > 0 && !machine.The_machine_is_under_maintenance__c) {
                const firstJobByDate = allJobs[0];
                const otherJobs = allJobs.slice(1);

                if (firstJobByDate.Status__c !== 'In Progress') {
                    updateJobStatus({
                        jobId: firstJobByDate.Id,
                        status: 'In Progress',
                        machineId: machine.Id
                    })
                        .catch(error => {
                            console.error('Error updating first job status:', error);
                        });
                }

                otherJobs.forEach(job => {
                    if (job.Status__c !== 'Scheduled') {
                        updateJobStatus({
                            jobId: job.Id,
                            status: 'Scheduled',
                            machineId: machine.Id
                        })
                            .catch(error => {
                                console.error('Error updating job status:', error);
                            });
                    }
                });
            }

            let inProgressJobs = allJobs.filter(job => job.Status__c === 'In Progress');
            let scheduledJobs = allJobs.filter(job => job.Status__c === 'Scheduled');

            if (allJobs.length > 0 && !machine.The_machine_is_under_maintenance__c) {
                const earliestJobByDate = allJobs[0];

                if (this.isFirstLoad) {
                    if (!inProgressJobs.some(job => job.Id === earliestJobByDate.Id)) {
                        inProgressJobs = [earliestJobByDate];
                        scheduledJobs = scheduledJobs.filter(job => job.Id !== earliestJobByDate.Id);
                    }

                    const otherJobIds = allJobs.slice(1).map(job => job.Id);
                    scheduledJobs = [
                        ...scheduledJobs,
                        ...inProgressJobs.filter(job => otherJobIds.includes(job.Id))
                    ];
                    inProgressJobs = inProgressJobs.filter(job => job.Id === earliestJobByDate.Id);
                } else {
                    if (inProgressJobs.length === 0 && scheduledJobs.length > 0) {
                        scheduledJobs.sort((a, b) => {
                            if (a.Date_In__c && b.Date_In__c) {
                                return new Date(a.Date_In__c) - new Date(b.Date_In__c);
                            } else if (a.Date_In__c) {
                                return -1;
                            } else if (b.Date_In__c) {
                                return 1;
                            }
                            return 0;
                        });

                        const promotedJob = scheduledJobs[0];

                        if (promotedJob) {
                            updateJobStatus({
                                jobId: promotedJob.Id,
                                status: 'In Progress',
                                machineId: machine.Id
                            })
                                .catch(error => {
                                    console.error('Error promoting job to In Progress:', error);
                                });

                            const updatedPromotedJob = { ...promotedJob, Status__c: 'In Progress' };
                            inProgressJobs = [updatedPromotedJob];
                            scheduledJobs = scheduledJobs.filter(job => job.Id !== promotedJob.Id);
                        }
                    } else if (inProgressJobs.length > 1) {
                        inProgressJobs.sort((a, b) => {
                            if (a.Date_In__c && b.Date_In__c) {
                                return new Date(a.Date_In__c) - new Date(b.Date_In__c);
                            } else if (a.Date_In__c) {
                                return -1;
                            } else if (b.Date_In__c) {
                                return 1;
                            }
                            return 0;
                        });

                        const keepJobId = inProgressJobs[0].Id;
                        const jobsToMove = inProgressJobs.slice(1);

                        jobsToMove.forEach(job => {
                            updateJobStatus({
                                jobId: job.Id,
                                status: 'Scheduled',
                                machineId: machine.Id
                            })
                                .catch(error => {
                                    console.error('Error moving job to Scheduled:', error);
                                });
                        });

                        inProgressJobs = inProgressJobs.filter(job => job.Id === keepJobId);
                        scheduledJobs = [
                            ...scheduledJobs,
                            ...jobsToMove.map(job => ({ ...job, Status__c: 'Scheduled' }))
                        ];
                    }
                }
            }

            scheduledJobs.sort((a, b) => {
                if (a.Date_In__c && b.Date_In__c) {
                    return new Date(a.Date_In__c) - new Date(b.Date_In__c);
                } else if (a.Date_In__c) {
                    return -1;
                } else if (b.Date_In__c) {
                    return 1;
                }
                return 0;
            });

            let lastDateOut = null;

            if (inProgressJobs.length > 0 && inProgressJobs[0].Date_Out__c) {
                lastDateOut = new Date(inProgressJobs[0].Date_Out__c);
            }

            scheduledJobs = scheduledJobs.map((job, index) => {
                const updatedJob = { ...job };

                if (index === 0 && lastDateOut) {
                    updatedJob.Date_In__c = this.formatDate(lastDateOut);

                    const dateOut = new Date(lastDateOut);
                    dateOut.setDate(dateOut.getDate() + 3);
                    updatedJob.Date_Out__c = this.formatDate(dateOut);

                    lastDateOut = dateOut;
                } else if (index > 0 && lastDateOut) {
                    updatedJob.Date_In__c = this.formatDate(lastDateOut);

                    const dateOut = new Date(lastDateOut);
                    dateOut.setDate(dateOut.getDate() + 3);
                    updatedJob.Date_Out__c = this.formatDate(dateOut);

                    lastDateOut = dateOut;
                } else if (index === 0 && !lastDateOut) {
                    if (!updatedJob.Date_In__c) {
                        const today = new Date();
                        updatedJob.Date_In__c = this.formatDate(today);
                    }

                    if (updatedJob.Date_In__c) {
                        const dateIn = new Date(updatedJob.Date_In__c);
                        const dateOut = new Date(dateIn);
                        dateOut.setDate(dateOut.getDate() + 3);
                        updatedJob.Date_Out__c = this.formatDate(dateOut);
                        lastDateOut = dateOut;
                    }
                }

                return updatedJob;
            });

            return {
                ...machine,
                inProgressJobs,
                scheduledJobs,
                Remaining_Capacity__c: remainingCapacity > 0 ? remainingCapacity : 0
            };
        });

        // Set the machine records directly in sequential order
        this.machineRecords = processedData;

        if (this.isFirstLoad) {
            setTimeout(() => {
                refreshApex(this.wiredMachinesResult);
            }, 500);
        }

        console.log('Processed Machine Records (Sequential):', JSON.stringify(this.machineRecords));

        setTimeout(() => {
            this.applyDiffStyles();
            this.applyMaintenanceStyles();
        }, 0);
    }

    formatDate(date) {
        if (!date) return null;

        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();

        return `${year}-${month}-${day}`;
    }

    applyDiffStyles() {
        const lateElements = this.template.querySelectorAll('.late-value');
        const earlyElements = this.template.querySelectorAll('.early-value');

        lateElements.forEach(element => {
            element.style.color = '#ff5252';
        });

        earlyElements.forEach(element => {
            element.style.color = '#4caf50';
        });
    }

    applyMaintenanceStyles() {
        const maintenanceWarnings = this.template.querySelectorAll('.maintenance-warning');

        maintenanceWarnings.forEach(element => {
            element.style.color = '#ff5252';
            element.style.fontWeight = 'bold';
        });
    }

    handleDragStart(event) {
        const jobId = event.currentTarget.dataset.jobId;
        this.draggedJobId = jobId;
        event.dataTransfer.setData('text/plain', jobId);

        event.currentTarget.classList.add('dragging');

        // Start auto-scroll monitoring
        this.startAutoScrollMonitoring();

        console.log('Drag started with job ID:', jobId);
    }

    startAutoScrollMonitoring() {
        // Add mouse move listener to track position during drag
        document.addEventListener('dragover', this.handleDragMouseMove.bind(this));

        // Start auto-scroll interval
        this.autoScrollInterval = setInterval(() => {
            if (this.scrollSpeed !== 0 || this.horizontalScrollSpeed !== 0) {
                this.performScroll();
            }
        }, 16); // ~60fps for smooth scrolling
    }

    handleDragMouseMove(event) {
        if (!this.draggedJobId) return;

        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const mouseY = event.clientY;
        const mouseX = event.clientX;

        // Calculate vertical scroll zones
        const topZone = this.scrollZoneSize;
        const bottomZone = viewportHeight - this.scrollZoneSize;

        // Calculate horizontal scroll zones  
        const leftZone = this.scrollZoneSize;
        const rightZone = viewportWidth - this.scrollZoneSize;

        // Reset scroll speeds
        this.scrollSpeed = 0;
        this.horizontalScrollSpeed = 0;

        // Vertical scrolling
        if (mouseY < topZone) {
            // Mouse in top scroll zone - scroll up
            const intensity = (topZone - mouseY) / topZone; // 0 to 1
            this.scrollSpeed = -Math.max(2, intensity * 20); // Negative for up
        } else if (mouseY > bottomZone) {
            // Mouse in bottom scroll zone - scroll down
            const intensity = (mouseY - bottomZone) / this.scrollZoneSize; // 0 to 1
            this.scrollSpeed = Math.max(2, intensity * 20); // Positive for down
        }

        // Horizontal scrolling for machine dashboard
        if (mouseX < leftZone) {
            // Mouse in left scroll zone - scroll left
            const intensity = (leftZone - mouseX) / leftZone; // 0 to 1
            this.horizontalScrollSpeed = -Math.max(2, intensity * 15); // Negative for left
        } else if (mouseX > rightZone) {
            // Mouse in right scroll zone - scroll right
            const intensity = (mouseX - rightZone) / this.scrollZoneSize; // 0 to 1
            this.horizontalScrollSpeed = Math.max(2, intensity * 15); // Positive for right
        }
    }

    performScroll() {
        // Vertical scrolling
        if (Math.abs(this.scrollSpeed) > 0) {
            window.scrollBy(0, this.scrollSpeed);
        }

        // Horizontal scrolling for machine dashboard
        if (Math.abs(this.horizontalScrollSpeed || 0) > 0) {
            const dashboard = this.template.querySelector('.machine-dashboard');
            if (dashboard) {
                dashboard.scrollBy(this.horizontalScrollSpeed, 0);
            }
        }
    }

    stopAutoScrollMonitoring() {
        // Remove mouse move listener
        document.removeEventListener('dragover', this.handleDragMouseMove.bind(this));

        // Clear auto-scroll interval
        if (this.autoScrollInterval) {
            clearInterval(this.autoScrollInterval);
            this.autoScrollInterval = null;
        }

        // Reset scroll speeds
        this.scrollSpeed = 0;
        this.horizontalScrollSpeed = 0;
    }

    handleDragEnd(event) {
        event.currentTarget.classList.remove('dragging');

        // Stop auto-scroll monitoring
        this.stopAutoScrollMonitoring();

        // Clear all drag over effects
        this.clearDragOverEffects();

        // Clear the dragged job ID after a short delay to ensure drop events can complete
        setTimeout(() => {
            this.draggedJobId = null;
        }, 150);
    }

    handleJobDragOver(event) {
        event.preventDefault();
        event.stopPropagation();

        const isScheduledSection = event.target.closest('.job-section')?.querySelector('h3')?.textContent === 'Scheduled';
        if (!isScheduledSection) return;

        const jobCard = event.currentTarget;
        const draggedJobId = this.draggedJobId;

        // Don't show drag over effect on the same job being dragged
        if (jobCard.dataset.jobId === draggedJobId) return;

        const rect = jobCard.getBoundingClientRect();
        const mouseY = event.clientY;
        const cardMiddle = rect.top + rect.height / 2;

        // Clear all previous drag over effects
        this.clearJobDragOverEffects();

        // Add appropriate drag over effect
        if (mouseY < cardMiddle) {
            jobCard.classList.add('drag-over-top');
        } else {
            jobCard.classList.add('drag-over-bottom');
        }
    }

    handleJobDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();

        const relatedTarget = event.relatedTarget;
        const currentTarget = event.currentTarget;

        // Only clear effects if we're truly leaving the job item
        if (!currentTarget.contains(relatedTarget)) {
            setTimeout(() => {
                // Double check we're not over another job item
                const elementUnderMouse = document.elementFromPoint(event.clientX, event.clientY);
                const jobItemUnderMouse = elementUnderMouse?.closest('.job-item');

                if (!jobItemUnderMouse || jobItemUnderMouse === currentTarget) {
                    this.clearJobDragOverEffects();
                }
            }, 10);
        }
    }

    clearJobDragOverEffects() {
        const allJobItems = this.template.querySelectorAll('.job-item');
        allJobItems.forEach(item => {
            item.classList.remove('drag-over-top', 'drag-over-bottom');
        });
    }

    clearDragOverEffects() {
        // Clear job drag over effects
        this.clearJobDragOverEffects();

        // Clear machine drag over effects
        const allMachineCards = this.template.querySelectorAll('.machine-card');
        allMachineCards.forEach(card => {
            card.classList.remove('drag-over');
        });
    }

    allowDrop(event) {
        event.preventDefault();
        event.stopPropagation();

        const machineCard = this.findMachineCardElement(event.target);
        if (machineCard && !machineCard.classList.contains('drag-over')) {
            // Clear other machine drag over effects first
            const allMachineCards = this.template.querySelectorAll('.machine-card');
            allMachineCards.forEach(card => {
                card.classList.remove('drag-over');
            });

            machineCard.classList.add('drag-over');
        }
    }

    handleMachineDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();

        const relatedTarget = event.relatedTarget;
        const currentTarget = event.currentTarget;

        if (!currentTarget.contains(relatedTarget)) {
            currentTarget.classList.remove('drag-over');
        }
    }

    handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();

        // Stop auto-scroll immediately on drop
        this.stopAutoScrollMonitoring();

        let jobId = event.dataTransfer.getData('text/plain');
        if (!jobId && this.draggedJobId) {
            jobId = this.draggedJobId;
        }

        if (!jobId) {
            console.error('No job ID found for drop');
            this.clearDragOverEffects();
            return;
        }

        const droppedOnJobCard = event.target.closest('.job-item');
        const isScheduledSection = event.target.closest('.job-section')?.querySelector('h3')?.textContent === 'Scheduled';

        // Check if we're dropping on a job card within scheduled section for reordering
        if (droppedOnJobCard && isScheduledSection) {
            const targetMachineCard = this.findMachineCardElement(droppedOnJobCard);
            const targetMachineId = targetMachineCard?.dataset.machineId;

            if (targetMachineId) {
                // Find the source machine for the dragged job
                let sourceMachine = null;
                for (let m of this.machineRecords) {
                    const foundInProgress = m.inProgressJobs?.find(job => job.Id === jobId);
                    const foundScheduled = m.scheduledJobs?.find(job => job.Id === jobId);
                    if (foundInProgress || foundScheduled) {
                        sourceMachine = m;
                        break;
                    }
                }

                // If it's the same machine and we're in scheduled section, handle reordering
                if (sourceMachine && sourceMachine.Id === targetMachineId) {
                    this.handleJobReordering(jobId, targetMachineId, droppedOnJobCard, event);
                    this.clearDragOverEffects();
                    this.draggedJobId = null;
                    return;
                }
            }
        }

        // Handle regular drop to machine
        const machineCardElement = this.findMachineCardElement(event.target);
        if (!machineCardElement) {
            console.error('Could not find machine card element');
            this.clearDragOverEffects();
            return;
        }

        const machineId = machineCardElement.dataset.machineId;

        if (!machineId) {
            console.error('Missing machine ID');
            this.clearDragOverEffects();
            return;
        }

        const machine = this.machineRecords.find(m => m.Id === machineId);
        if (machine && machine.The_machine_is_under_maintenance__c) {
            this.showToast('Error', 'Cannot assign jobs to a machine under maintenance', 'error');
            this.clearDragOverEffects();
            return;
        }

        console.log('Drop event - Job ID:', jobId, 'Machine ID:', machineId);

        // Find source machine and clear manual ordering if moving between machines
        let sourceMachine = null;
        for (let m of this.machineRecords) {
            const foundInProgress = m.inProgressJobs?.find(job => job.Id === jobId);
            const foundScheduled = m.scheduledJobs?.find(job => job.Id === jobId);
            if (foundInProgress || foundScheduled) {
                sourceMachine = m;
                break;
            }
        }

        if (sourceMachine && sourceMachine.Id !== machineId) {
            this.manualJobOrders.delete(sourceMachine.Id);
            this.manualJobOrders.delete(machineId);
        }

        const isMachineItemDrop = event.target.closest('.machine-item') !== null;
        const status = isMachineItemDrop ? 'In Progress' : '';

        updateJobStatus({ jobId, status, machineId })
            .then(() => {
                if (status === 'In Progress') {
                    this.showToast('Success', 'Job marked as In Progress', 'success');
                    if (this.manualJobOrders.has(machineId)) {
                        const currentOrder = this.manualJobOrders.get(machineId);
                        const updatedOrder = currentOrder.filter(id => id !== jobId);
                        this.manualJobOrders.set(machineId, updatedOrder);
                    }
                } else {
                    this.showToast('Success', 'Job moved successfully', 'success');
                }
                return refreshApex(this.wiredMachinesResult);
            })
            .catch(error => {
                console.error('Error updating job:', error);
                this.showToast('Error', 'Error updating job: ' + error.message, 'error');
            })
            .finally(() => {
                this.clearDragOverEffects();
                this.draggedJobId = null;
            });
    }

    handleJobReordering(draggedJobId, machineId, droppedOnJobCard, event) {
        console.log('Handling job reordering:', draggedJobId, machineId);

        const machine = this.machineRecords.find(m => m.Id === machineId);
        if (!machine) {
            console.error('Machine not found for reordering');
            return;
        }

        const targetJobId = droppedOnJobCard.dataset.jobId;
        if (draggedJobId === targetJobId) {
            console.log('Cannot drop job on itself');
            return;
        }

        const draggedJobIndex = machine.scheduledJobs.findIndex(job => job.Id === draggedJobId);
        const targetJobIndex = machine.scheduledJobs.findIndex(job => job.Id === targetJobId);

        if (draggedJobIndex === -1) {
            console.error('Dragged job not found in scheduled jobs');
            return;
        }

        if (targetJobIndex === -1) {
            console.error('Target job not found in scheduled jobs');
            return;
        }

        const reorderedJobs = [...machine.scheduledJobs];
        const [draggedJob] = reorderedJobs.splice(draggedJobIndex, 1);

        // Determine insertion position based on drag over indicator
        let insertIndex;
        const hasTopIndicator = droppedOnJobCard.classList.contains('drag-over-top');
        const hasBottomIndicator = droppedOnJobCard.classList.contains('drag-over-bottom');

        if (hasTopIndicator) {
            // Insert before the target job
            insertIndex = targetJobIndex > draggedJobIndex ? targetJobIndex - 1 : targetJobIndex;
        } else if (hasBottomIndicator) {
            // Insert after the target job
            insertIndex = targetJobIndex > draggedJobIndex ? targetJobIndex : targetJobIndex + 1;
        } else {
            // Fallback: determine by mouse position
            const rect = droppedOnJobCard.getBoundingClientRect();
            const mouseY = event.clientY;
            const cardMiddle = rect.top + rect.height / 2;

            if (mouseY < cardMiddle) {
                insertIndex = targetJobIndex > draggedJobIndex ? targetJobIndex - 1 : targetJobIndex;
            } else {
                insertIndex = targetJobIndex > draggedJobIndex ? targetJobIndex : targetJobIndex + 1;
            }
        }

        // Ensure insert index is within bounds
        insertIndex = Math.max(0, Math.min(insertIndex, reorderedJobs.length));

        reorderedJobs.splice(insertIndex, 0, draggedJob);

        console.log(`Moving job from index ${draggedJobIndex} to ${insertIndex}`);

        this.recalculateDateSequence(machine, reorderedJobs);
        this.updateMachineJobOrder(machineId, reorderedJobs);

        this.showToast('Success', 'Job order updated successfully', 'success');
    }

    recalculateDateSequence(machine, reorderedJobs) {
        let lastDateOut = null;

        if (machine.inProgressJobs.length > 0 && machine.inProgressJobs[0].Date_Out__c) {
            lastDateOut = new Date(machine.inProgressJobs[0].Date_Out__c);
        } else {
            lastDateOut = new Date();
        }

        reorderedJobs.forEach((job, index) => {
            job.Date_In__c = this.formatDate(lastDateOut);

            const dateOut = new Date(lastDateOut);
            dateOut.setDate(dateOut.getDate() + 3);
            job.Date_Out__c = this.formatDate(dateOut);

            lastDateOut = dateOut;
        });
    }

    updateMachineJobOrder(machineId, reorderedJobs) {
        this.machineRecords = this.machineRecords.map(machine => {
            if (machine.Id === machineId) {
                return {
                    ...machine,
                    scheduledJobs: reorderedJobs
                };
            }
            return machine;
        });

        console.log('Updated job order for machine:', machineId, reorderedJobs);
    }

    handleSplitOrder(event) {
        const orderId = event.detail.orderId;
        const weight = event.detail.weight;

        splitOrderToMachines({ orderId: orderId, weight: weight })
            .then(result => {
                this.showToast('Success', 'Order successfully split across machines', 'success');
                return refreshApex(this.wiredMachinesResult);
            })
            .catch(error => {
                console.error('Error splitting order:', error);
                this.showToast('Error', 'Error splitting order: ' + error.message, 'error');
            });
    }

    findMachineCardElement(element) {
        while (element && !element.classList.contains('machine-card')) {
            element = element.parentElement;
        }
        return element;
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    renderedCallback() {
        this.applyDiffStyles();
        this.applyMaintenanceStyles();
    }

    disconnectedCallback() {
        // Clean up auto-scroll monitoring when component is destroyed
        this.stopAutoScrollMonitoring();
    }
}